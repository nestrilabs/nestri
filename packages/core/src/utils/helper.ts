export function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
    if (chunkSize <= 0) {
        throw new Error("chunkSize must be a positive integer");
    }
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        chunks.push(arr.slice(i, i + chunkSize));
    }
    return chunks;
}