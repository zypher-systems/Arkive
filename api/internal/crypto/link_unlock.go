package crypto

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const LinkUnlockTTL = 24 * time.Hour

// MintLinkUnlock returns an opaque unlock proof for a passworded public link.
func MintLinkUnlock(secretsKey, linkToken string) string {
	exp := time.Now().Add(LinkUnlockTTL).Unix()
	mac := linkUnlockMAC(secretsKey, linkToken, exp)
	return fmt.Sprintf("%d.%s", exp, base64.RawURLEncoding.EncodeToString(mac))
}

// VerifyLinkUnlock checks a cookie value minted by MintLinkUnlock.
func VerifyLinkUnlock(secretsKey, linkToken, cookie string) bool {
	expStr, sig, ok := strings.Cut(strings.TrimSpace(cookie), ".")
	if !ok || expStr == "" || sig == "" {
		return false
	}
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || exp < time.Now().Unix() {
		return false
	}
	want, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		return false
	}
	got := linkUnlockMAC(secretsKey, linkToken, exp)
	return hmac.Equal(want, got)
}

func linkUnlockMAC(secretsKey, linkToken string, exp int64) []byte {
	mac := hmac.New(sha256.New, []byte(secretsKey))
	_, _ = mac.Write([]byte("pl|"))
	_, _ = mac.Write([]byte(linkToken))
	_, _ = mac.Write([]byte("|"))
	_, _ = mac.Write([]byte(strconv.FormatInt(exp, 10)))
	return mac.Sum(nil)
}
