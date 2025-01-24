package auth

import (
	"encoding/json"
	"fmt"
	"io"
	"nestri/maitred/pkg/resource"
	"net/http"
	"net/url"
	"os/exec"

	"github.com/charmbracelet/log"
)

type UserCredentials struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

func FetchUserToken(teamID string) (*UserCredentials, error) {
	hostname := GetHostname()
	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "device")
	data.Set("client_secret", resource.Resource.AuthFingerprintKey.Value)
	data.Set("team", teamID)
	data.Set("hostname", hostname)
	data.Set("provider", "device")
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

func GetHostname() string {
	cmd, err := exec.Command("cat", "/etc/hostname").Output()
	if err != nil {
		log.Error("error getting container hostname", "err", err)
	}
	output := string(cmd)
	return output
}
