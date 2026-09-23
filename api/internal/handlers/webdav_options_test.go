package handlers

import "testing"

func TestWebDAVAdvertisesClass2(t *testing.T) {
	if davClassHeader != "1, 2" {
		t.Fatalf("DAV class=%q want \"1, 2\"", davClassHeader)
	}
}

func TestOIDCEmailTakenSentinel(t *testing.T) {
	if errOIDCEmailTaken.Error() != "oidc email already registered" {
		t.Fatal(errOIDCEmailTaken)
	}
}
