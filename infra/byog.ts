// The idea is to have people use their own GPUs to play. It is somewhere between (fully) self-hosting and cloud
// How will it work?


/**
 * [Website] <-> [API] <-> [Realtime]<->[Nestri Manager]<-> [Nestri runner]
 * 
 * The website starts a session, the api adds it to the realtime API which the Nestri manager is listening to. The Nestri manager then starts the docker server.
 * 
 * Scaling of machines, is beyond us. Registering the machine is also done manually by the user.
 * 
 */