import type {
    Tag,
    StoreTags,
    AppDepots,
    GenreType,
    LibraryAssetsFull,
    DepotEntry,
    CompareOpts,
    CompareResult,
    RankedShot,
    Shot,
    ProfileInfo,
} from "./types";
import crypto from 'crypto';
import pLimit from 'p-limit';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { LRUCache } from 'lru-cache';
import sanitizeHtml from 'sanitize-html';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { parseStringPromise } from "xml2js";
import sharp, { type Metadata } from 'sharp';
import AbortController from 'abort-controller';
import fetch, { RequestInit } from 'node-fetch';
import { FastAverageColor } from 'fast-average-color';

const fac = new FastAverageColor()
// --- Configuration ---
const httpAgent = new HttpAgent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 50 });
const downloadCache = new LRUCache<string, Buffer>({
    max: 100,
    ttl: 1000 * 60 * 30,      // 30-minute expiry
    allowStale: false,
});
const downloadLimit = pLimit(10); // max concurrent downloads
const compareCache = new LRUCache<string, CompareResult>({
    max: 50,
    ttl: 1000 * 60 * 10,  // 10-minute expiry
});

export namespace Utils {
    export async function fetchBuffer(url: string, retries = 3): Promise<Buffer> {
        if (downloadCache.has(url)) {
            return downloadCache.get(url)!;
        }

        let lastError: Error | null = null;

        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), 15_000);
                const res = await fetch(url, {
                    signal: controller.signal,
                    agent: (_parsed) => _parsed.protocol === 'http:' ? httpAgent : httpsAgent
                } as RequestInit);
                clearTimeout(id);
                if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
                const buf = Buffer.from(await res.arrayBuffer());
                downloadCache.set(url, buf);
                return buf;
            } catch (error: any) {
                lastError = error as Error;
                console.warn(`Attempt ${attempt + 1} failed for ${url}: ${error.message}`);
                if (attempt < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
                }
            }
        }

        throw lastError || new Error(`Failed to fetch ${url} after ${retries} attempts`);
    }

    export async function getImageMetadata(buffer: Buffer) {
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        const { width, height, format, size: fileSize } = await sharp(buffer).metadata();
        if (!width || !height) throw new Error('Invalid dimensions');

        const slice = await sharp(buffer)
            .resize({ width: Math.min(width, 256) }) // cheap shrink
            .ensureAlpha()
            .raw()
            .toBuffer();

        const pixelArray = new Uint8Array(slice.buffer);
        const { hex, isDark } = fac.prepareResult(fac.getColorFromArray4(pixelArray, { mode: "precision" }));

        return { hash, format, averageColor: { hex, isDark }, dimensions: { width, height }, fileSize, buffer };
    }

    // --- Optimized Box Art creation ---
    export async function createBoxArtBuffer(
        logoUrl: string,
        backgroundUrl: string,
        logoPercent = 0.9
    ): Promise<Buffer> {
        const [bgBuf, logoBuf] = await Promise.all([
            downloadLimit(() =>
                fetchBuffer(backgroundUrl)
                    .catch(error => {
                        console.error(`Failed to download hero image from ${backgroundUrl}:`, error);
                        throw new Error(`Failed to create box art: hero image unavailable`);
                    }),
            ),
            downloadLimit(() => fetchBuffer(logoUrl)
                .catch(error => {
                    console.error(`Failed to download logo image from ${logoUrl}:`, error);
                    throw new Error(`Failed to create box art: logo image unavailable`);
                }),
            ),
        ]);

        const bgImage = sharp(bgBuf);
        const meta = await bgImage.metadata();
        if (!meta.width || !meta.height) throw new Error('Invalid background dimensions');
        const size = Math.min(meta.width, meta.height);
        const left = Math.floor((meta.width - size) / 2);
        const top = Math.floor((meta.height - size) / 2);
        const squareBg = bgImage.extract({ left, top, width: size, height: size });

        // Resize logo
        const logoTarget = Math.floor(size * logoPercent);
        const logoResized = await sharp(logoBuf).resize({ width: logoTarget }).toBuffer();
        const logoMeta = await sharp(logoResized).metadata();
        if (!logoMeta.width || !logoMeta.height) throw new Error('Invalid logo dimensions');
        const logoLeft = Math.floor((size - logoMeta.width) / 2);
        const logoTop = Math.floor((size - logoMeta.height) / 2);

        return await squareBg
            .composite([{ input: logoResized, left: logoLeft, top: logoTop }])
            .jpeg({ quality: 100 })
            .toBuffer();
    }

    /**
   * Fetch JSON from the given URL, with Steam-like headers
   */
    export async function fetchApi<T>(url: string, retries = 3): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const response = await fetch(url, {
                    agent: (_parsed) => _parsed.protocol === 'http:' ? httpAgent : httpsAgent,
                    method: "GET",
                    headers: {
                        "User-Agent": "Steam 1291812 / iPhone",
                        "Accept-Language": "en-us",
                    },
                } as RequestInit);
                if (!response.ok) {
                    throw new Error(`API error: ${response.status} ${response.statusText}`);
                }

                return (await response.json()) as T;
            } catch (error: any) {
                lastError = error as Error;
                // Only retry on network errors or 5xx status codes
                if (error.message.includes('API error: 5') || !error.message.includes('API error')) {
                    console.warn(`Attempt ${attempt + 1} failed for ${url}: ${error.message}`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
                    continue;
                }
                throw error;
            }
        }

        throw lastError || new Error(`Failed to fetch ${url} after ${retries} attempts`);
    }

    /**
     * Generate a slug from a name
     */
    export function createSlug(name: string): string {
        return name
            .toLowerCase()
            .normalize("NFKD") // Normalize to decompose accented characters
            .replace(/[^\p{L}\p{N}\s-]/gu, '') // Keep Unicode letters, numbers, spaces, and hyphens
            .replace(/\s+/g, '-')              // Replace spaces with hyphens
            .replace(/-+/g, '-')               // Collapse multiple hyphens
            .replace(/^-+|-+$/g, '')           // Trim leading/trailing hyphens
            .trim();
    }

    /**
     * Compare a candidate screenshot against a UI-free baseline to find how much UI/HUD remains.
     *
     * @param baselineBuffer - PNG/JPEG buffer of the clean background.
     * @param candidateBuffer - PNG/JPEG buffer of the screenshot to test.
     * @param opts - Options.
     * @returns Promise resolving to diff ratio (and optional diff image).
     */
    export async function compareWithBaseline(
        baselineBuffer: Buffer,
        candidateBuffer: Buffer,
        opts: CompareOpts = {}
    ): Promise<CompareResult> {
        // Generate cache key from buffer hashes
        const baseHash = crypto.createHash('md5').update(baselineBuffer).digest('hex');
        const candHash = crypto.createHash('md5').update(candidateBuffer).digest('hex');
        const optsKey = JSON.stringify(opts);
        const cacheKey = `${baseHash}:${candHash}:${optsKey}`;

        // Check cache
        if (compareCache.has(cacheKey)) {
            return compareCache.get(cacheKey)!;
        }

        const { threshold = 0.1, diffOutput = false } = opts;

        // Get dimensions of baseline
        const baseMeta: Metadata = await sharp(baselineBuffer).metadata();
        if (!baseMeta.width || !baseMeta.height) {
            throw new Error('Invalid baseline dimensions');
        }

        // Produce PNG buffers of same size
        const [pngBaseBuf, pngCandBuf] = await Promise.all([
            sharp(baselineBuffer).png().toBuffer(),
            sharp(candidateBuffer)
                .resize(baseMeta.width, baseMeta.height)
                .png()
                .toBuffer(),
        ]);

        const imgBase = PNG.sync.read(pngBaseBuf);
        const imgCand = PNG.sync.read(pngCandBuf);
        const diffImg = new PNG({ width: baseMeta.width, height: baseMeta.height });

        const numDiff = pixelmatch(
            imgBase.data,
            imgCand.data,
            diffImg.data,
            baseMeta.width,
            baseMeta.height,
            { threshold }
        );

        const total = baseMeta.width * baseMeta.height;
        const diffRatio = numDiff / total;

        const result: CompareResult = { diffRatio };
        if (diffOutput) {
            result.diffBuffer = PNG.sync.write(diffImg);
        }

        compareCache.set(cacheKey, result);
        return result;
    }

    /**
 * Given a baseline buffer and an array of screenshots, returns them sorted
 * ascending by diffRatio (least UI first).
 */
    export async function rankScreenshots(
        baselineBuffer: Buffer,
        shots: Shot[],
        opts: CompareOpts = {}
    ): Promise<RankedShot[]> {
        // Process up to 5 comparisons in parallel
        const compareLimit = pLimit(5);

        // Run all comparisons with limited concurrency
        const results = await Promise.all(
            shots.map(shot =>
                compareLimit(async () => {
                    const { diffRatio } = await compareWithBaseline(
                        baselineBuffer,
                        shot.buffer,
                        opts
                    );
                    return { url: shot.url, score: diffRatio };
                })
            )
        );

        return results.sort((a, b) => a.score - b.score);
    }

    // --- Helpers for URLs ---
    export function getScreenshotUrls(screenshots: { appid: number; filename: string }[]): string[] {
        return screenshots.map(s => `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${s.appid}/${s.filename}`);
    }

    export function getAssetUrls(assets: LibraryAssetsFull, appid: number | string, header: string) {
        const base = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}`;
        return {
            logo: `${base}/${assets.library_logo?.image2x?.english || assets.library_logo?.image?.english}`,
            backdrop: `${base}/${assets.library_hero?.image2x?.english || assets.library_hero?.image?.english}`,
            poster: `${base}/${assets.library_capsule?.image2x?.english || assets.library_capsule?.image?.english}`,
            banner: `${base}/${assets.library_header?.image2x?.english || assets.library_header?.image?.english || header}`,
        };
    }

    /**
     *  Compute a 0–5 score from positive/negative votes using a Wilson score confidence interval.
     *  This formula adjusts the raw ratio based on the total number of votes to account for 
     *  statistical confidence. With few votes, the score regresses toward 2.5 (neutral).
     * 
     *  Compute a 0–5 score from positive/negative votes
     */
    export function getRating(positive: number, negative: number): number {
        const total = positive + negative;
        if (!total) return 0;
        const avg = positive / total;
        // Apply Wilson score confidence adjustment and scale to 0-5 range
        const score = avg - (avg - 0.5) * Math.pow(2, -Math.log10(total + 1));
        return Math.round(score * 5 * 10) / 10;
    }

    export function getAssociationsByTypeWithSlug<
        T extends "developer" | "publisher"
    >(
        associations: Record<string, { name: string; type: string }>,
        type: T
    ): Array<{ name: string; slug: string; type: T }> {
        return Object.values(associations)
            .filter((a) => a.type === type)
            .map((a) => ({ name: a.name.trim(), slug: createSlug(a.name.trim()), type }));
    }

    export function compatibilityType(type?: string): "low" | "mid" | "high" | "unknown" {
        switch (type) {
            case "1":
                return "high";
            case "2":
                return "mid";
            case "3":
                return "low";
            default:
                return "unknown";
        }
    }


    export function estimateRatingFromSummary(
        reviewCount: number,
        percentPositive: number
    ): number {
        const positiveVotes = Math.round((percentPositive / 100) * reviewCount);
        const negativeVotes = reviewCount - positiveVotes;
        return getRating(positiveVotes, negativeVotes);
    }

    export function mapGameTags<
        T extends string = "tag"
    >(
        available: Tag[],
        storeTags: StoreTags,
    ): Array<{ name: string; slug: string; type: T }> {
        const tagMap = new Map<number, Tag>(available.map((t) => [t.tagid, t]));
        const result: Array<{ name: string; slug: string; type: T }> = Object.values(storeTags)
            .map((id) => tagMap.get(Number(id)))
            .filter((t): t is Tag => Boolean(t))
            .map((t) => ({ name: t.name.trim(), slug: createSlug(t.name), type: 'tag' as T }));

        return result;
    }

    export function createType<
        T extends "developer" | "publisher" | "franchise" | "tag" | "categorie" | "genre"
    >(
        names: string[],
        type: T
    ) {
        return names
            .map(name => ({
                type,
                name: name.trim(),
                slug: createSlug(name.trim())
            }));
    }

    /**
    * Create a tag object with name, slug, and type
    * @typeparam T Literal type of the `type` field (defaults to 'tag')
    */
    export function createTag<
        T extends string = 'tag'
    >(
        name: string,
        type?: T
    ): { name: string; slug: string; type: T } {
        const tagType = (type ?? 'tag') as T;
        return {
            name: name.trim(),
            slug: createSlug(name),
            type: tagType,
        };
    }

    export function capitalise(name: string) {
        return name
            .charAt(0) // first character
            .toUpperCase() // make it uppercase
            + name
                .slice(1) // rest of the string
                .toLowerCase();
    }

    function isDepotEntry(e: any): e is DepotEntry {
        return (
            e != null &&
            typeof e === 'object' &&
            'manifests' in e &&
            e.manifests != null &&
            typeof e.manifests.public?.download === 'string'
        );
    }

    export function getPublicDepotSizes(depots: AppDepots) {
        let download = 0;
        let size = 0;

        for (const key of Object.keys(depots)) {
            if (key === 'branches' || key === 'privatebranches') continue;
            const entry = depots[key] as DepotEntry;
            if (!isDepotEntry(entry)) {
                continue;
            }

            const dl = Number(entry.manifests.public.download);
            const sz = Number(entry.manifests.public.size);
            if (!Number.isFinite(dl) || !Number.isFinite(sz)) {
                console.warn(`[getPublicDepotSizes] non-numeric size for depot ${key}`);
                continue;
            }

            download += dl;
            size += sz;
        }

        return { downloadSize: download, sizeOnDisk: size };
    }

    export function parseGenres(str: string): GenreType[] {
        return str.split(',')
            .map((g) => g.trim())
            .filter(Boolean)
            .map((g) => ({ type: 'genre', name: g.trim(), slug: createSlug(g) }));
    }

    export function getPrimaryGenre(
        genres: GenreType[],
        map: Record<string, string>,
        primaryId: string
    ): string | null {
        const idx = Object.keys(map).find((k) => map[k] === primaryId);
        return idx !== undefined ? genres[Number(idx)]?.name : null;
    }

    export function cleanDescription(input: string): string {

        const cleaned = sanitizeHtml(input, {
            allowedTags: [],         // no tags allowed
            allowedAttributes: {},   // no attributes anywhere
            textFilter: (text) => text.replace(/\s+/g, ' '), // collapse runs of whitespace
        });

        return cleaned.trim()
    }

    /**
     * Fetches and parses a single Steam community profile XML.
     * @param steamIdOrVanity - The 64-bit SteamID or vanity name.
     * @returns Promise resolving to ProfileInfo.
     */
    export async function fetchProfileInfo(
        steamIdOrVanity: string
    ): Promise<ProfileInfo> {
        const isNumericId = /^\d+$/.test(steamIdOrVanity);
        const path = isNumericId ? `profiles/${steamIdOrVanity}` : `id/${steamIdOrVanity}`;
        const url = `https://steamcommunity.com/${path}/?xml=1`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${steamIdOrVanity}: HTTP ${response.status}`);
        }

        const xml = await response.text();
        const { profile } = await parseStringPromise(xml, {
            explicitArray: false,
            trim: true,
            mergeAttrs: true
        }) as { profile: any };

        // Extract fields (fall back to limitedAccount tag if needed)
        const limitedFlag = profile.isLimitedAccount ?? profile.limitedAccount;
        const isLimited = limitedFlag === '1';

        return {
            isLimited,
            steamID64: profile.steamID64,
            privacyState: profile.privacyState,
            visibility: profile.visibilityState
        };
    }

    /**
     * Batch-fetches multiple Steam profiles in parallel.
     * @param idsOrVanities - Array of SteamID64 strings or vanity names.
     * @returns Promise resolving to a record mapping each input to its ProfileInfo or an error.
     */
    export async function fetchProfilesInfo(
        idsOrVanities: string[]
    ): Promise<Map<string, ProfileInfo | { error: string }>> {
        const results = await Promise.all(
            idsOrVanities.map(async (input) => {
                try {
                    const info = await fetchProfileInfo(input);
                    return { input, result: info };
                } catch (err) {
                    return { input, result: { error: (err as Error).message } };
                }
            })
        );

        return new Map(
            results.map(({ input, result }) => [input, result] as [string, ProfileInfo | { error: string }])
        );
    }
}