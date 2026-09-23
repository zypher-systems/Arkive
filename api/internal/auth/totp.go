package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// RFC 6238 TOTP with the parameters every authenticator app supports:
// HMAC-SHA1, 6 digits, 30 second period.
const (
	TOTPPeriod = 30
	TOTPDigits = 6
	// TOTPSkew is the number of steps accepted on either side of "now".
	TOTPSkew = 1
)

var totpEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// NewTOTPSecret returns a fresh 160-bit secret, base32 encoded without padding.
func NewTOTPSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return totpEncoding.EncodeToString(buf), nil
}

func decodeTOTPSecret(secret string) ([]byte, error) {
	s := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(secret), " ", ""))
	s = strings.TrimRight(s, "=")
	return totpEncoding.DecodeString(s)
}

// TOTPStep returns the RFC 6238 time step counter for t.
func TOTPStep(t time.Time) int64 {
	return t.Unix() / TOTPPeriod
}

// hotp implements RFC 4226 with dynamic truncation to `digits` digits.
func hotp(key []byte, counter uint64, digits int) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	bin := (uint32(sum[off])&0x7f)<<24 |
		uint32(sum[off+1])<<16 |
		uint32(sum[off+2])<<8 |
		uint32(sum[off+3])
	mod := uint32(1)
	for i := 0; i < digits; i++ {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", digits, bin%mod)
}

// TOTPCode returns the code for secret (base32) at step.
func TOTPCode(secret string, step int64) (string, error) {
	key, err := decodeTOTPSecret(secret)
	if err != nil {
		return "", err
	}
	return hotp(key, uint64(step), TOTPDigits), nil
}

// NormalizeTOTPCode strips spaces users commonly type.
func NormalizeTOTPCode(code string) string {
	return strings.ReplaceAll(strings.TrimSpace(code), " ", "")
}

// LooksLikeTOTPCode reports whether code is exactly TOTPDigits decimal digits.
func LooksLikeTOTPCode(code string) bool {
	code = NormalizeTOTPCode(code)
	if len(code) != TOTPDigits {
		return false
	}
	for _, c := range code {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// ValidateTOTP checks code against secret at time now, accepting ±TOTPSkew
// steps. Steps <= lastStep are rejected (replay protection: a code cannot be
// used twice, and neither can an older code once a newer one was accepted).
// Pass lastStep = -1 when nothing was used yet. Returns the matched step.
func ValidateTOTP(secret, code string, now time.Time, lastStep int64) (int64, bool) {
	code = NormalizeTOTPCode(code)
	if !LooksLikeTOTPCode(code) {
		return 0, false
	}
	key, err := decodeTOTPSecret(secret)
	if err != nil || len(key) == 0 {
		return 0, false
	}
	cur := TOTPStep(now)
	matched := int64(-1)
	for d := -TOTPSkew; d <= TOTPSkew; d++ {
		step := cur + int64(d)
		if step < 0 {
			continue
		}
		want := hotp(key, uint64(step), TOTPDigits)
		// Constant-time compare; keep looping to avoid timing differences.
		// Prefer the newest matching step so lastStep advances maximally.
		if subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 && step > lastStep {
			matched = step
		}
	}
	if matched < 0 {
		return 0, false
	}
	return matched, true
}

// TOTPURL builds the otpauth:// provisioning URL for authenticator apps.
func TOTPURL(issuer, account, secret string) string {
	label := url.PathEscape(issuer) + ":" + url.PathEscape(account)
	q := url.Values{}
	q.Set("secret", secret)
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", fmt.Sprint(TOTPDigits))
	q.Set("period", fmt.Sprint(TOTPPeriod))
	return "otpauth://totp/" + label + "?" + q.Encode()
}
