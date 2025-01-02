package api

import (
	"context"
	"fmt"

	"github.com/nestrilabs/nestri-go-sdk"
	"github.com/nestrilabs/nestri-go-sdk/option"
)

func RegisterMachine(token string) {
	client := nestri.NewClient(
		option.WithBearerToken(token),
		option.WithBaseURL("https://api.lauryn.dev.nestri.io/"),
	)
	machine, err := client.Machines.List(context.TODO()) //Get(context.TODO(), "REPLACE_ME")

	if err != nil {
		panic(err.Error())
	}
	fmt.Printf("%+v\n", machine.Data)
}
