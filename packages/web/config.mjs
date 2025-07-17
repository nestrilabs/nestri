const stage = process.env.SST_STAGE || "dev";

export default {
  url: stage === "production"
    ? "nestri.io"
    : `https://${stage}.nestri.io`
}
