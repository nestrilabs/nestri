// The idea is to have Nvidia GPU's hosted on AWS that we can use to run the games
// How will it work?


/**
 * [Website] <-> [API] <-> [SQS Queue] <->[Lambda]<-> [ECS] <-> [EC2] <-> [Nestri runner]
 * 
 * The website starts a session, the api adds this to an SQS queue, a lambda function subscribes to the queue and is tasked with starting ECS tasks.
 * 
 * The ECS tasks are running the Nestri runner docker image on EC2 (Not FARGATE)
 * 
 * The EC2 part needs autoscaling as well, this should be handled in another file.
 */