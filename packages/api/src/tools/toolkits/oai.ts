import type { ExtendedJsonSchema } from '../registry/schema';
import { OPENAI_IMAGE_QUALITIES } from './imaging';

/** Default descriptions for image generation tool  */
const DEFAULT_IMAGE_GEN_DESCRIPTION =
  `Generates high-quality, original images based solely on text, not using any uploaded reference images.

When to use \`image_gen_oai\`:
- To create entirely new images from detailed text descriptions that do NOT reference any image files.

When NOT to use \`image_gen_oai\`:
- If the user has uploaded any images and requests modifications, enhancements, or remixing based on those uploads → use \`image_edit_oai\` instead.

Generated image IDs will be returned in the response, so you can refer to them in future requests made to \`image_edit_oai\`.` as const;

const getImageGenDescription = () => {
  return process.env.IMAGE_GEN_OAI_DESCRIPTION || DEFAULT_IMAGE_GEN_DESCRIPTION;
};

/** Default prompt descriptions  */
const DEFAULT_IMAGE_GEN_PROMPT_DESCRIPTION = `Describe the image you want in detail. 
      Be highly specific—break your idea into layers: 
      (1) main concept and subject,
      (2) composition and position,
      (3) lighting and mood,
      (4) style, medium, or camera details,
      (5) important features (age, expression, clothing, etc.),
      (6) background.
      Use positive, descriptive language and specify what should be included, not what to avoid. 
      List number and characteristics of people/objects, and mention style/technical requirements (e.g., "DSLR photo, 85mm lens, golden hour").
      Do not reference any uploaded images—use for new image creation from text only.` as const;

const getImageGenPromptDescription = () => {
  return process.env.IMAGE_GEN_OAI_PROMPT_DESCRIPTION || DEFAULT_IMAGE_GEN_PROMPT_DESCRIPTION;
};

/** Default description for image editing tool  */
const DEFAULT_IMAGE_EDIT_DESCRIPTION =
  `Generates high-quality, original images based on text and one or more uploaded/referenced images.

When to use \`image_edit_oai\`:
- The user wants to modify, extend, or remix one **or more** uploaded images, either:
- Previously generated, or in the current request (both to be included in the \`image_ids\` array).
- Always when the user refers to uploaded images for editing, enhancement, remixing, style transfer, or combining elements.
- Any current or existing images are to be used as visual guides.
- If there are any files in the current request, they are more likely than not expected as references for image edit requests.

When NOT to use \`image_edit_oai\`:
- Brand-new generations that do not rely on an existing image → use \`image_gen_oai\` instead.

Both generated and referenced image IDs will be returned in the response, so you can refer to them in future requests made to \`image_edit_oai\`.
`.trim();

const getImageEditDescription = () => {
  return process.env.IMAGE_EDIT_OAI_DESCRIPTION || DEFAULT_IMAGE_EDIT_DESCRIPTION;
};

const DEFAULT_IMAGE_EDIT_PROMPT_DESCRIPTION = `Describe the changes, enhancements, or new ideas to apply to the uploaded image(s).
      Be highly specific—break your request into layers: 
      (1) main concept or transformation,
      (2) specific edits/replacements or composition guidance,
      (3) desired style, mood, or technique,
      (4) features/items to keep, change, or add (such as objects, people, clothing, lighting, etc.).
      Use positive, descriptive language and clarify what should be included or changed, not what to avoid.
      Always base this prompt on the most recently uploaded reference images.`;

const getImageEditPromptDescription = () => {
  return process.env.IMAGE_EDIT_OAI_PROMPT_DESCRIPTION || DEFAULT_IMAGE_EDIT_PROMPT_DESCRIPTION;
};

/** `auto` or `WIDTHxHEIGHT`; the image API enforces which dimensions the configured model supports. */
export const IMAGE_SIZE_PATTERN = '^(auto|[1-9][0-9]*x[1-9][0-9]*)$';

/** Most images one call may return; each is saved and shown to the user. */
export const MAX_IMAGES_PER_CALL = 4;

const qualityProperty: ExtendedJsonSchema = {
  type: 'string',
  enum: [...OPENAI_IMAGE_QUALITIES],
  description:
    'Rendering quality: auto (default), low, medium, high, or the higher xhigh and max tiers for the most detailed output. Models without xhigh/max use high instead. Higher quality takes longer and costs more; use it for text-heavy images, fine detail, or when asked.',
};

const sizeProperty: ExtendedJsonSchema = {
  type: 'string',
  pattern: IMAGE_SIZE_PATTERN,
  description:
    'WIDTHxHEIGHT in pixels, or auto (default). Every model accepts 1024x1024, 1536x1024 (landscape) and 1024x1536 (portrait). Newer models also take custom sizes: both sides multiples of 16, no side over 3840, aspect ratio at most 3:1, and 655,360 to 8,294,400 pixels in total (e.g. 2048x2048, 3840x2160, 2160x3840). An unsupported size returns an explanation instead of an image.',
};

const backgroundProperty: ExtendedJsonSchema = {
  type: 'string',
  enum: ['transparent', 'opaque', 'auto'],
  description:
    'Sets transparency for the background. Must be one of transparent, opaque or auto (default). Use transparent for logos, icons or stickers.',
};

const countProperty: ExtendedJsonSchema = {
  type: 'integer',
  minimum: 1,
  maximum: MAX_IMAGES_PER_CALL,
  description: `How many variations to create, 1 (default) to ${MAX_IMAGES_PER_CALL}. Only ask for more than one when the user wants options to choose from.`,
};

const imageGenOaiJsonSchema: ExtendedJsonSchema = {
  type: 'object',
  properties: {
    prompt: {
      type: 'string',
      maxLength: 32000,
      description: getImageGenPromptDescription(),
    },
    background: backgroundProperty,
    quality: qualityProperty,
    size: sizeProperty,
    n: countProperty,
  },
  required: ['prompt'],
};

const imageEditOaiJsonSchema: ExtendedJsonSchema = {
  type: 'object',
  properties: {
    image_ids: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      description: `IDs (image ID strings) of previously generated or uploaded images that should guide the edit.

Guidelines:
- If the user's request depends on any prior image(s), copy their image IDs into the \`image_ids\` array (in the same order the user refers to them).  
- Never invent or hallucinate IDs; only use IDs that are still visible in the conversation context.
- If no earlier image is relevant, omit the field entirely.`,
    },
    prompt: {
      type: 'string',
      maxLength: 32000,
      description: getImageEditPromptDescription(),
    },
    background: backgroundProperty,
    quality: qualityProperty,
    size: sizeProperty,
    n: countProperty,
  },
  required: ['image_ids', 'prompt'],
};

export const oaiToolkit: {
  readonly image_gen_oai: {
    readonly name: 'image_gen_oai';
    readonly description: string;
    readonly schema: ExtendedJsonSchema;
    readonly responseFormat: 'content_and_artifact';
  };
  readonly image_edit_oai: {
    readonly name: 'image_edit_oai';
    readonly description: string;
    readonly schema: ExtendedJsonSchema;
    readonly responseFormat: 'content_and_artifact';
  };
} = {
  image_gen_oai: {
    name: 'image_gen_oai' as const,
    description: getImageGenDescription(),
    schema: imageGenOaiJsonSchema,
    responseFormat: 'content_and_artifact' as const,
  } as const,
  image_edit_oai: {
    name: 'image_edit_oai' as const,
    description: getImageEditDescription(),
    schema: imageEditOaiJsonSchema,
    responseFormat: 'content_and_artifact' as const,
  },
} as const;
