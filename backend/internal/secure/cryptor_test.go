package secure

import (
	"bytes"
	"testing"
)

func TestCryptorRoundTrip(t *testing.T) {
	cryptor, err := NewCryptor(bytes.Repeat([]byte{0x42}, 32))
	if err != nil {
		t.Fatal(err)
	}

	ciphertext, err := cryptor.Encrypt("sk-secret-value")
	if err != nil {
		t.Fatal(err)
	}
	if ciphertext == "sk-secret-value" {
		t.Fatal("secret was stored in plaintext")
	}

	plaintext, err := cryptor.Decrypt(ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if plaintext != "sk-secret-value" {
		t.Fatalf("got %q", plaintext)
	}
}

func TestCryptorRejectsTampering(t *testing.T) {
	cryptor, err := NewCryptor(bytes.Repeat([]byte{0x42}, 32))
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := cryptor.Encrypt("secret")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := cryptor.Decrypt(ciphertext + "x"); err == nil {
		t.Fatal("expected authentication failure")
	}
}
