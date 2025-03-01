//Created manually from the dashboard and shared with the whole team/org
const dbProject = neon.getProjectOutput({
    id:"red-mud-17843368"
})

const dbBranchId = $app.stage !== "production" ?
    new neon.Branch("DatabaseBranch", {
        parentId: dbProject.defaultBranchId,
        projectId: dbProject.id,
        name: $app.stage,
    }).id : dbProject.defaultBranchId

const dbEndpoint = new neon.Endpoint("NestriEndpoint", {
    projectId: dbProject.id,
    branchId: dbBranchId
})

const dbRole = new neon.Role("AdminRole", {
    name: "admin",
    branchId: dbBranchId,
    projectId: dbProject.id,
})

const db = new neon.Database("NestriDatabase", {
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