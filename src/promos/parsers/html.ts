import { DOMParser } from "linkedom";

export const parseHtml = (html: string) => new DOMParser().parseFromString(html, "text/html");
export type HtmlDocument = ReturnType<typeof parseHtml>;
