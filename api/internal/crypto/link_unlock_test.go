package crypto

import "testing"

func TestLinkUnlockRoundTrip(t *testing.T) {
	key := "test-secrets-key"
	token := "link-token-abc"
	cookie := MintLinkUnlock(key, token)
	if !VerifyLinkUnlock(key, token, cookie) {
		t.Fatal("expected valid unlock cookie")
	}
	if VerifyLinkUnlock(key, "other-token", cookie) {
		t.Fatal("cookie must be bound to link token")
	}
	if VerifyLinkUnlock("other-key", token, cookie) {
		t.Fatal("cookie must be bound to secrets key")
	}
	if VerifyLinkUnlock(key, token, "not-a-cookie") {
		t.Fatal("garbage cookie must fail")
	}
}
