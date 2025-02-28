package auth

import (
	"encoding/json"
	"fmt"
	"io"
	"nestri/maitred/internal/resource"
	"net/http"
	"net/url"
	"os"

	"github.com/charmbracelet/log"
)

type UserCredentials struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

func FetchUserToken() (*UserCredentials, error) {
	hostname, err := os.Hostname()
	if err != nil {
		log.Fatal("Could not get the hostname")
	}
	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "task")
	data.Set("client_secret", resource.Resource.AuthFingerprintKey.Value)
	data.Set("hostname", hostname)
	data.Set("provider", "task")
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
