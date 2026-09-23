package auth

import (
	"strings"
	"testing"
	"time"
)

// RFC 6238 Appendix B test vectors (SHA1 seed "12345678901234567890").
// The RFC lists 8-digit codes; the 6-digit code is the last 6 digits.
func TestTOTPRFC6238Vectors(t *testing.T) {
	secret := totpEncoding.EncodeToString([]byte("12345678901234567890"))
	cases := []struct {
		unix int64
		want string
	}{
		{59, "94287082"},
		{1111111109, "07081804"},
		{1111111111, "14050471"},
		{1234567890, "89005924"},
		{2000000000, "69279037"},
		{20000000000, "65353130"},
	}
	key, err := decodeTOTPSecret(secret)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		step := TOTPStep(time.Unix(c.unix, 0))
		if got := hotp(key, uint64(step), 8); got != c.want {
			t.Errorf("t=%d 8-digit got %s want %s", c.unix, got, c.want)
		}
		got6, err := TOTPCode(secret, step)
		if err != nil {
			t.Fatal(err)
		}
		if got6 != c.want[2:] {
			t.Errorf("t=%d 6-digit got %s want %s", c.unix, got6, c.want[2:])
		}
		if _, ok := ValidateTOTP(secret, c.want[2:], time.Unix(c.unix, 0), -1); !ok {
			t.Errorf("t=%d vector should validate", c.unix)
		}
	}
}

func TestValidateTOTPWindowAndReplay(t *testing.T) {
	secret, err := NewTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0)
	cur := TOTPStep(now)
	code := func(step int64) string {
		c, err := TOTPCode(secret, step)
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	inWindow := map[string]bool{code(cur - 1): true, code(cur): true, code(cur + 1): true}
	for _, d := range []int64{-1, 0, 1} {
		if step, ok := ValidateTOTP(secret, code(cur+d), now, -1); !ok || step != cur+d {
			t.Fatalf("offset %d should validate (step=%d ok=%v)", d, step, ok)
		}
	}
	for _, d := range []int64{-3, -2, 2, 3} {
		c := code(cur + d)
		if inWindow[c] { // astronomically unlikely collision
			continue
		}
		if _, ok := ValidateTOTP(secret, c, now, -1); ok {
			t.Fatalf("offset %d must be rejected", d)
		}
	}
	step, ok := ValidateTOTP(secret, code(cur), now, -1)
	if !ok {
		t.Fatal("first use should pass")
	}
	if _, ok := ValidateTOTP(secret, code(cur), now, step); ok {
		t.Fatal("replayed code must be rejected")
	}
	if _, ok := ValidateTOTP(secret, code(cur-1), now, step); ok {
		t.Fatal("older step after newer must be rejected")
	}
	if _, ok := ValidateTOTP(secret, code(cur+1), now, step); !ok {
		t.Fatal("newer step should pass")
	}
	// Replay 30s later (same code, now at step cur+1, still within skew).
	if _, ok := ValidateTOTP(secret, code(cur), now.Add(30*time.Second), step); ok {
		t.Fatal("replay in the next period must be rejected")
	}
	for _, bad := range []string{"", "12345", "1234567", "abcdef", "12 34 5x"} {
		if _, ok := ValidateTOTP(secret, bad, now, -1); ok {
			t.Fatalf("%q must be rejected", bad)
		}
	}
	c := code(cur)
	if _, ok := ValidateTOTP(secret, c[:3]+" "+c[3:], now, -1); !ok {
		t.Fatal("spaced code should pass")
	}
}

func TestTOTPURL(t *testing.T) {
	u := TOTPURL("Arkive", "a+b@example.com", "ABC")
	if !strings.HasPrefix(u, "otpauth://totp/Arkive:a+b@example.com?") {
		t.Fatal(u)
	}
	if !strings.Contains(u, "secret=ABC") || !strings.Contains(u, "issuer=Arkive") {
		t.Fatal(u)
	}
}
