package handlers

import "testing"

func TestWebDAVAdvertisesClass1(t *testing.T) {
	if davClassHeader != "1" {
		t.Fatalf("DAV class=%q want 1", davClassHeader)
	}
}

func TestOIDCEmailTakenSentinel(t *testing.T) {
	if errOIDCEmailTaken.Error() != "oidc email already registered" {
		t.Fatal(errOIDCEmailTaken)
	}
}
