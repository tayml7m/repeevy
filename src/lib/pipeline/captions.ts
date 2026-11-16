/**
 * Caption / title / first-comment rendering.
 *
 * Variables: {original_caption} {original_title} {original_first_comment}
 *            {source_url} {hashtags} {title} {date} {workflow_name} {source_platform}
 */
import type { Provider, Workflow, WorkflowDestination } from "@prisma/client";

import type { SourcePost } from "@/lib/adapters/types";

export type CaptionInput = {
  workflow: Workflow;
  destination?: WorkflowDestination | null;
  sourcePlatform?: Provider | string;
  sourcePostId: string;
  publishedAt?: Date | null;
  sourceUrl?: string | null;
  title?: string | null;
  caption?: string | null;
  firstComment?: string | null;
  hashtags: string[];
};

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const MENTION_RE = /@[\p{L}\p{N}_.]+/gu;

export function normalizeHashtag(tag: string): string {
  const trimmed = tag.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

export function normalizeHashtags(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeHashtag).filter(Boolean))];
}

export function extractHashtags(text?: string | null): string[] {
  if (!text) return [];
  return normalizeHashtags(text.match(HASHTAG_RE) ?? []);
}

export function stripHashtags(text: string): string {
  return text
    .replace(HASHTAG_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function stripMentions(text: string): string {
  return text.replace(MENTION_RE, "").replace(/[ \t]{2,}/g, " ").trim();
}

function captionText(input: CaptionInput, opts: { stripTags: boolean; stripMentions: boolean }): string {
  let text = input.caption ?? "";
  if (opts.stripTags) text = stripHashtags(text);
  if (opts.stripMentions) text = stripMentions(text);
  return text.trim();
}

function buildVariables(
  input: CaptionInput,
  opts: { stripTags: boolean; stripMentions: boolean },
): Record<string, string> {
  const text = captionText(input, opts);
  const tags = opts.stripTags ? input.hashtags : normalizeHashtags(input.hashtags);
  const title = (input.title ?? text.split("\n")[0] ?? "").trim();

  return {
    original_caption: text,
    original_title: title,
    original_first_comment: input.firstComment ?? "",
    source_url: input.sourceUrl ?? "",
    hashtags: tags.join(" "),
    title,
    date: (input.publishedAt ?? new Date()).toISOString().slice(0, 10),
    workflow_name: input.workflow.name,
    source_platform: String(input.sourcePlatform ?? ""),
  };
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (match, key: string) => variables[key] ?? match);
}

function applyLengthLimit(text: string, limit?: number): string {
  if (!limit || text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  return (lastBreak > limit * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd();
}

/** Renders the destination caption with hashtag and prefix/suffix rules. */
export function buildCaption(input: CaptionInput, limit?: number): string {
  const stripTags = Boolean(input.workflow.stripHashtags) || input.workflow.replaceHashtags.length > 0;
  const opts = { stripTags, stripMentions: !input.workflow.preserveMentions };
  const variables = buildVariables(input, opts);

  const template =
    input.destination?.captionTemplate?.trim() ||
    input.workflow.captionTemplate?.trim() ||
    "{original_caption}";

  let body = renderTemplate(template, variables).trim();

  // Hashtags: strip/replace or carry them across when the template forgot them.
  const tags = stripTags ? normalizeHashtags(input.workflow.replaceHashtags) : variables.hashtags;
  if (tags && !/\{hashtags\}/.test(template)) {
    body = `${body}${body.endsWith("\n") ? "" : "\n\n"}${tags}`.trim();
  } else {
    body = body.replace(/\n{3,}/g, "\n\n").trim();
  }

  const prefix = input.workflow.captionPrefix?.trim();
  const suffix = input.workflow.captionSuffix?.trim();
  if (prefix) body = `${prefix} ${body}`.trim();
  if (suffix) body = `${body}\n\n${suffix}`.trim();

  return applyLengthLimit(body, limit);
}

/**
 * Title rules: destination template first, otherwise the first caption line
 * (hashtags stripped) capped at the platform's title limit.
 */
export function buildTitle(input: CaptionInput, limit = 100): string {
  const opts = {
    stripTags: true,
    stripMentions: !input.workflow.preserveMentions,
  };
  const variables = buildVariables(input, opts);
  const template = input.destination?.titleTemplate?.trim();

  const raw = template
    ? renderTemplate(template, variables)
    : (input.title ?? variables.original_caption.split("\n")[0] ?? "");

  const cleaned = raw.replace(/\s+/g, " ").trim();
  return applyLengthLimit(cleaned, limit) || "Repurposed post";
}

/** First comment is only rendered when the workflow opted into it. */
export function buildFirstComment(input: CaptionInput): string | null {
  if (!input.workflow.repurposeFirstComment) return null;
  const opts = {
    stripTags: Boolean(input.workflow.stripHashtags),
    stripMentions: !input.workflow.preserveMentions,
  };
  const variables = buildVariables(input, opts);
  const template =
    input.destination?.firstCommentTemplate?.trim() ||
    input.workflow.firstCommentTemplate?.trim() ||
    "{original_first_comment}";

  const rendered = renderTemplate(template, variables).trim();
  return rendered || null;
}

/** CaptionInput factory from a detected source post. */
export function captionInputFor(
  workflow: Workflow,
  destination: WorkflowDestination | null,
  post: Pick<SourcePost, "id" | "url" | "title" | "caption" | "firstComment" | "hashtags" | "publishedAt">,
  sourcePlatform: string,
): CaptionInput {
  return {
    workflow,
    destination,
    sourcePlatform,
    sourcePostId: post.id,
    publishedAt: post.publishedAt,
    sourceUrl: post.url,
    title: post.title,
    caption: post.caption,
    firstComment: post.firstComment,
    hashtags: normalizeHashtags(post.hashtags ?? extractHashtags(post.caption)),
  };
}
