package config

import (
	"bytes"
	"strings"
	"testing"
)

func TestBlobTotalBytesEnvUsesWholeGiBAndSupportsUnlimited(t *testing.T) {
	tests := []struct {
		name      string
		value     string
		expected  int64
		expectErr bool
	}{
		{name: "default", expected: 2 * bytesPerGB},
		{name: "unlimited", value: "0", expected: 0},
		{name: "whole GiB", value: " 3 ", expected: 3 * bytesPerGB},
		{name: "negative", value: "-1", expectErr: true},
		{name: "fractional", value: "1.5", expectErr: true},
		{name: "not a number", value: "many", expectErr: true},
		{name: "overflow", value: "8589934592", expectErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("NARRATIUM_MAX_BLOB_TOTAL_GB", test.value)
			actual, err := blobTotalBytesEnv()
			if test.expectErr {
				if err == nil {
					t.Fatalf("blobTotalBytesEnv() = %d, want an error", actual)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if actual != test.expected {
				t.Fatalf("blobTotalBytesEnv() = %d, want %d", actual, test.expected)
			}
		})
	}
}

func TestLoadDerivesStableKeysFromRequiredMasterSecret(t *testing.T) {
	prepareLoadEnvironment(t, t.TempDir())
	t.Setenv("NARRATIUM_SECRET", "configured-master-secret-with-at-least-32-bytes")

	first, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	second, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(first.JWTSecret) != 32 || len(first.EncryptionKey) != 32 ||
		!bytes.Equal(first.JWTSecret, second.JWTSecret) || !bytes.Equal(first.EncryptionKey, second.EncryptionKey) ||
		bytes.Equal(first.JWTSecret, first.EncryptionKey) {
		t.Fatal("master secret did not produce stable, separated keys")
	}
}

func TestLoadRejectsShortMasterSecret(t *testing.T) {
	prepareLoadEnvironment(t, t.TempDir())
	t.Setenv("NARRATIUM_SECRET", "too-short")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "at least 32 bytes") {
		t.Fatalf("Load error = %v", err)
	}
}

func prepareLoadEnvironment(t *testing.T, dataDir string) {
	t.Helper()
	t.Setenv("NARRATIUM_DATA_DIR", dataDir)
	t.Setenv("NARRATIUM_MAX_BLOB_TOTAL_GB", "")
}
