const machine = new fly.Machine("NestriRelay", {
    app: "",
    name: "",
    image: "",
    region: "",
    services: [{
        protocol: "udp",
        internalPort: 10000,
        ports: [{ startPort: 10000, endPort: 20000 }]
    }]
})

machine.autoDestroy