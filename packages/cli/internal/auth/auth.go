package auth

import (
	"encoding/json"
	"fmt"
	"io"
	"nestrilabs/cli/internal/resource"
	"net/http"
	"net/url"

	"github.com/google/uuid"
)

type UserCredentials struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

func FetchUserToken() (*UserCredentials, error) {
	data := url.Values{}
	redirect := fmt.Sprintf("%s%s", resource.Resource.Auth.Url, "/device/callback")
	// data.Set("grant_type", "client_credentials")
	data.Set("grant_type", "authorization_code")
	data.Set("client_id", "device")
	data.Set("redirect_uri", redirect)
	data.Set("response_type", "code")
	data.Set("state", uuid.New().String())
	// data.Set("client_secret", resource.Resource.AuthFingerprintKey.Value)
	// data.Set("fingerprint", machineID)
	data.Set("provider", "code")
	// data.Set("code", "318597")
	resp, err := http.PostForm(resource.Resource.Auth.Url+"/token", data)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		fmt.Println(string(body))
		return nil, fmt.Errorf("failed to auth: " + string(body))
	}
	credentials := UserCredentials{}
	err = json.NewDecoder(resp.Body).Decode(&credentials)
	if err != nil {
		return nil, err
	}
	return &credentials, nil
}
