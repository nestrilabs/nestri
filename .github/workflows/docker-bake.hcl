variable "BASE_IMAGE" {
  default = "docker.io/cachyos/cachyos:latest"
}

group "default" {
  targets = ["runner"]
}

target "runner-base" {
  dockerfile = "containerfiles/runner-base.Containerfile"
  context    = "."
  args = {
    BASE_IMAGE = "${BASE_IMAGE}"
  }
  cache-from = ["type=gha,scope=runner-base-pr"]
  cache-to = ["type=gha,scope=runner-base-pr,mode=max"]
  tags = ["runner-base:latest"]
}

target "runner-builder" {
  dockerfile = "containerfiles/runner-builder.Containerfile"
  context    = "."
  args = {
    RUNNER_BASE_IMAGE = "runner-base:latest"
  }
  cache-from = ["type=gha,scope=runner-builder-pr"]
  cache-to = ["type=gha,scope=runner-builder-pr,mode=max"]
  tags = ["runner-builder:latest"]
  contexts = {
    runner-base = "target:runner-base"
  }
}

target "runner" {
  dockerfile = "containerfiles/runner.Containerfile"
  context    = "."
  args = {
    RUNNER_BASE_IMAGE    = "runner-base:latest"
    RUNNER_BUILDER_IMAGE = "runner-builder:latest"
  }
  cache-from = ["type=gha,scope=runner-pr"]
  cache-to = ["type=gha,scope=runner-pr,mode=max"]
  tags = ["nestri-runner"]
  contexts = {
    runner-base    = "target:runner-base"
    runner-builder = "target:runner-builder"
  }
}
