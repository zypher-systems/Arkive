package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

const prefix = "enc:v1:"

func deriveKey(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

func Encrypt(secret, plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	block, err := aes.NewCipher(deriveKey(secret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	out := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return prefix + base64.RawStdEncoding.EncodeToString(out), nil
}

func Decrypt(secret, value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if !strings.HasPrefix(value, prefix) {
		return value, nil // plaintext legacy / seed
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(deriveKey(secret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", fmt.Errorf("ciphertext too short")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

type S3Config struct {
	Endpoint       string `json:"endpoint"`
	AccessKey      string `json:"access_key"`
	SecretKey      string `json:"secret_key"`
	Bucket         string `json:"bucket"`
	Region         string `json:"region"`
	UseSSL         bool   `json:"use_ssl"`
	ForcePathStyle bool   `json:"force_path_style"`
}

type NFSConfig struct {
	MountPath string `json:"mount_path"`
}

func EncryptS3Config(secret string, cfg S3Config) ([]byte, error) {
	ak, err := Encrypt(secret, cfg.AccessKey)
	if err != nil {
		return nil, err
	}
	sk, err := Encrypt(secret, cfg.SecretKey)
	if err != nil {
		return nil, err
	}
	cfg.AccessKey = ak
	cfg.SecretKey = sk
	return json.Marshal(cfg)
}

func DecryptS3Config(secret string, raw []byte) (S3Config, error) {
	var cfg S3Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, err
	}
	ak, err := Decrypt(secret, cfg.AccessKey)
	if err != nil {
		return cfg, err
	}
	sk, err := Decrypt(secret, cfg.SecretKey)
	if err != nil {
		return cfg, err
	}
	cfg.AccessKey = ak
	cfg.SecretKey = sk
	return cfg, nil
}

func ParseNFSConfig(raw []byte) (NFSConfig, error) {
	var cfg NFSConfig
	err := json.Unmarshal(raw, &cfg)
	return cfg, err
}

type GDriveConfig struct {
	RefreshToken string `json:"refresh_token"`
	AccessToken  string `json:"access_token"`
	TokenExpiry  string `json:"token_expiry"` // RFC3339
	RootFolderID string `json:"root_folder_id"`
	AccountEmail string `json:"account_email"`
	Mode         string `json:"mode,omitempty"` // "" | vault | live
}

func EncryptGDriveConfig(secret string, cfg GDriveConfig) ([]byte, error) {
	rt, err := Encrypt(secret, cfg.RefreshToken)
	if err != nil {
		return nil, err
	}
	at, err := Encrypt(secret, cfg.AccessToken)
	if err != nil {
		return nil, err
	}
	cfg.RefreshToken = rt
	cfg.AccessToken = at
	return json.Marshal(cfg)
}

func DecryptGDriveConfig(secret string, raw []byte) (GDriveConfig, error) {
	var cfg GDriveConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, err
	}
	rt, err := Decrypt(secret, cfg.RefreshToken)
	if err != nil {
		return cfg, err
	}
	at, err := Decrypt(secret, cfg.AccessToken)
	if err != nil {
		return cfg, err
	}
	cfg.RefreshToken = rt
	cfg.AccessToken = at
	return cfg, nil
}

func RedactGDriveConfig(cfg GDriveConfig) map[string]any {
	return map[string]any{
		"account_email":  cfg.AccountEmail,
		"root_folder_id": cfg.RootFolderID,
		"refresh_token":  mask(cfg.RefreshToken),
		"access_token":   mask(cfg.AccessToken),
		"mode":           cfg.Mode,
	}
}

type WebDAVConfig struct {
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

func EncryptWebDAVConfig(secret string, cfg WebDAVConfig) ([]byte, error) {
	pw, err := Encrypt(secret, cfg.Password)
	if err != nil {
		return nil, err
	}
	cfg.Password = pw
	return json.Marshal(cfg)
}

func DecryptWebDAVConfig(secret string, raw []byte) (WebDAVConfig, error) {
	var cfg WebDAVConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, err
	}
	pw, err := Decrypt(secret, cfg.Password)
	if err != nil {
		return cfg, err
	}
	cfg.Password = pw
	return cfg, nil
}

func RedactWebDAVConfig(cfg WebDAVConfig) map[string]any {
	return map[string]any{
		"url":      cfg.URL,
		"username": cfg.Username,
		"password": mask(cfg.Password),
	}
}

func RedactS3Config(cfg S3Config) map[string]any {
	return map[string]any{
		"endpoint":         cfg.Endpoint,
		"access_key":       mask(cfg.AccessKey),
		"secret_key":       mask(cfg.SecretKey),
		"bucket":           cfg.Bucket,
		"region":           cfg.Region,
		"use_ssl":          cfg.UseSSL,
		"force_path_style": cfg.ForcePathStyle,
	}
}

func mask(s string) string {
	if s == "" {
		return ""
	}
	return "••••••••"
}
