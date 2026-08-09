package auth

import "testing"

func TestHashAndCheckPassword(t *testing.T) {
	hash, err := HashPassword("correct-horse-battery")
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword("correct-horse-battery", hash) {
		t.Fatal("expected password to verify")
	}
	if CheckPassword("wrong-password", hash) {
		t.Fatal("expected wrong password to fail")
	}
}

func TestCheckPasswordRejectsGarbage(t *testing.T) {
	if CheckPassword("x", "not-a-hash") {
		t.Fatal("garbage hash should fail")
	}
}

func TestSessionTokenRoundTrip(t *testing.T) {
	plain, hash, err := NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	if plain == "" || hash == "" {
		t.Fatal("expected non-empty token")
	}
	if HashToken(plain) != hash {
		t.Fatal("HashToken mismatch")
	}
}
