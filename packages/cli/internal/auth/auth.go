package auth

import (
	"encoding/json"
	"fmt"
	"io"
	"nestrilabs/cli/internal/machine"
	"nestrilabs/cli/internal/resource"
	"net/http"
	"net/url"
)

type UserCredentials struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

func FetchUserToken() (*UserCredentials, error) {
	m := machine.NewMachine()
	fingerprint := m.GetMachineID()
	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "device")
	data.Set("provider", "device")
	data.Set("client_secret", resource.Resource.AuthFingerprintKey.Value)
	data.Set("hostname", m.Hostname)
	data.Set("fingerprint", fingerprint)
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
