//Created manually from the dashboard and shared with the whole team/org
const dbProject = neon.getProjectOutput({
    id: "little-band-76544985",
})

const dbBranchId = $app.stage !== "production" ?
    new neon.Branch("NeonBranch", {
        parentId: dbProject.defaultBranchId,
        projectId: dbProject.id,
        name: $app.stage,
    }).id : dbProject.defaultBranchId

const dbEndpoint = new neon.Endpoint("NeonEndpoint", {
    projectId: dbProject.id,
    branchId: dbBranchId,
    poolerEnabled: true,
    type: "read_write",
})

const dbRole = new neon.Role("NeonRole", {
    name: "admin",
    branchId: dbBranchId,
    projectId: dbProject.id,
})

const db = new neon.Database("NeonDatabase", {
    branchId: dbBranchId,
    projectId: dbProject.id,
    ownerName: dbRole.name,
    name: `nestri-${$app.stage}`,
})

export const database = new sst.Linkable("Database", {
    properties: {
        name: db.name,
        user: dbRole.name,
        host: dbEndpoint.host,
        password: dbRole.password,
    },
});