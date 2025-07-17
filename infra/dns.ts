export const domain = (() => {
  if ($app.stage === "production") return "nestri.io"
  if ($app.stage === "dev") return "nestri.io"
  return `${$app.stage}.dev.nestri.io`
})()
