package auth

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"nestri/maitred/internal/resource"
	"net/http"
	"net/url"
)

type UserCredentials struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

func FetchUserToken(machineID string, resource *resource.Resource) (*UserCredentials, error) {
	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "maitred")
	data.Set("client_secret", resource.AuthFingerprintKey.Value)
	data.Set("fingerprint", machineID)
	data.Set("provider", "machine")
	resp, err := http.PostForm(resource.Auth.Url+"/token", data)
	if err != nil {
		return nil, err
	}
	defer func(Body io.ReadCloser) {
		err = Body.Close()
		if err != nil {
			slog.Error("Error closing body", "err", err)
		}
	}(resp.Body)
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to auth: " + string(body))
	}
	credentials := UserCredentials{}
	err = json.NewDecoder(resp.Body).Decode(&credentials)
	if err != nil {
		return nil, err
	}
	return &credentials, nil
}
