package secure

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
)

const ciphertextVersion = "v1"

type Cryptor struct {
	aead cipher.AEAD
}

func NewCryptor(key []byte) (*Cryptor, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create AES cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM cipher: %w", err)
	}
	return &Cryptor{aead: aead}, nil
}

func (c *Cryptor) Encrypt(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate encryption nonce: %w", err)
	}
	sealed := c.aead.Seal(nil, nonce, []byte(plaintext), []byte(ciphertextVersion))
	payload := append(nonce, sealed...)
	return ciphertextVersion + ":" + base64.RawStdEncoding.EncodeToString(payload), nil
}

func (c *Cryptor) Decrypt(ciphertext string) (string, error) {
	if ciphertext == "" {
		return "", nil
	}
	version, encoded, ok := strings.Cut(ciphertext, ":")
	if !ok || version != ciphertextVersion {
		return "", errors.New("unsupported ciphertext format")
	}
	payload, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return "", errors.New("invalid ciphertext encoding")
	}
	if len(payload) < c.aead.NonceSize() {
		return "", errors.New("invalid ciphertext length")
	}
	nonce := payload[:c.aead.NonceSize()]
	sealed := payload[c.aead.NonceSize():]
	plaintext, err := c.aead.Open(nil, nonce, sealed, []byte(version))
	if err != nil {
		return "", errors.New("decrypt provider secret")
	}
	return string(plaintext), nil
}
