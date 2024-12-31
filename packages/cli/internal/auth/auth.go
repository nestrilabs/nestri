package auth

import (
	"fmt"
	"io"
	"nestrilabs/cli/internal/resource"
	"net/http"
	"net/url"

	"github.com/charmbracelet/log"
)

type UserCredentials struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

func FetchUserToken() error {
	data := url.Values{}
	redirect := "http://localhost:1999/parties/main/fc27f428f9ca47d4b41b707ae0c62090"
	data.Set("client_secret", resource.Resource.AuthFingerprintKey.Value)
	data.Set("redirect_url", redirect)
	resp, err := http.PostForm(resource.Resource.Auth.Url+"/device/callback", data)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		fmt.Println(string(body))
		return fmt.Errorf("failed to auth: " + string(body))
	}
	// credentials := UserCredentials{}
	body, _ := io.ReadAll(resp.Body)
	// fmt.Println(string(body))
	// err = json.NewDecoder(resp.Body).Decode(&credentials)
	// if err != nil {
	// 	return nil, err
	// }

	log.Info("Body returned", "body", string(body))
	return nil
}
