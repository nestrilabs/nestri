export interface CloudflareCF {
    colo: string;
    continent: string;
    country: string,
    city: string;
    region: string;
    longitude: number;
    latitude: number;
    metroCode: string;
    postalCode: string;
    timezone: string;
    regionCode: number;
}

export interface CFRequest extends Request {
    cf: CloudflareCF
}