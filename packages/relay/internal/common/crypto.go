package common

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"github.com/oklog/ulid/v2"
	"io"
	"time"
)

func NewULID() (ulid.ULID, error) {
	return ulid.New(ulid.Timestamp(time.Now()), ulid.Monotonic(rand.Reader, 0))
}

func GenerateECDHKeyPair() (*ecdsa.PrivateKey, error) {
	return ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
}

func GetPublicKeyBytes(pub *ecdsa.PublicKey) string {
	pubBytes, _ := x509.MarshalPKIXPublicKey(pub)
	return base64.StdEncoding.EncodeToString(pubBytes)
}

func ParsePublicKey(encoded string) (*ecdsa.PublicKey, error) {
	pubBytes, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	pub, err := x509.ParsePKIXPublicKey(pubBytes)
	if err != nil {
		return nil, err
	}
	return pub.(*ecdsa.PublicKey), nil
}

func ComputeSharedSecret(privKey *ecdsa.PrivateKey, peerPubKey *ecdsa.PublicKey) ([]byte, error) {
	privECDH, err := privKey.ECDH()
	if err != nil {
		return nil, err
	}
	peerECDH, err := peerPubKey.ECDH()
	if err != nil {
		return nil, err
	}
	return privECDH.ECDH(peerECDH)
}

func EncryptMessage(sharedSecret, plaintext []byte) (string, error) {
	block, err := aes.NewCipher(sharedSecret)
	if err != nil {
		return "", err
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := aesGCM.Seal(nonce, nonce, plaintext, nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func DecryptMessage(sharedSecret, encrypted string) ([]byte, error) {
	ciphertext, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher([]byte(sharedSecret))
	if err != nil {
		return nil, err
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}
	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	return aesGCM.Open(nil, nonce, ciphertext, nil)
}
