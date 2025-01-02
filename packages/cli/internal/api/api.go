package api

import (
	"context"
	"fmt"
	"nestrilabs/cli/internal/resource"

	"github.com/nestrilabs/nestri-go-sdk"
	"github.com/nestrilabs/nestri-go-sdk/option"
)

func RegisterMachine(token string) {
	client := nestri.NewClient(
		option.WithBearerToken(token),
		option.WithBaseURL(resource.Resource.Api.Url),
	)

	machine, err := client.Machines.New(
		context.TODO(),
		nestri.MachineNewParams{})

	if err != nil {
		panic(err.Error())
	}
	fmt.Printf("%+v\n", machine.Data)
}
