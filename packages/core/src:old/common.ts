import { z } from "zod";
import "zod-openapi/extend";

export module Common {
  export const IdDescription = `Unique object identifier.
The format and length of IDs may change over time.`;
}