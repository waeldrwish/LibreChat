const axios = require('axios');
const OpenAI = require('openai');
const { ContentTypes } = require('librechat-data-provider');
const createOpenAIImageTools = require('../OpenAIImageTools');

jest.mock('axios');
jest.mock('openai');
jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));
jest.mock('~/models', () => ({ getFiles: jest.fn().mockResolvedValue([]) }));
jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: () => ({ getDownloadStream: async () => 'image-stream' }),
}));

const IMAGE = 'aGVsbG8=';

/** Builds the two tools as an agent would, with the admin panel's image settings. */
function makeTools(imageGeneration, imageFiles = []) {
  const [generate, edit] = createOpenAIImageTools({
    isAgent: true,
    IMAGE_GEN_OAI_API_KEY: 'test-key',
    imageOutputType: 'png',
    fileStrategy: 'local',
    imageFiles,
    req: { user: { id: 'user-1' }, config: { imageGeneration } },
  });
  return { generate, edit };
}

const call = (tool, args) =>
  tool.invoke({ id: 'call_1', name: tool.name, args, type: 'tool_call' });

describe('OpenAI Image Tools', () => {
  const generateImages = jest.fn();
  const savedModel = process.env.IMAGE_GEN_OAI_MODEL;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.IMAGE_GEN_OAI_MODEL;
    OpenAI.mockImplementation(() => ({ images: { generate: generateImages } }));
  });

  afterAll(() => {
    if (savedModel !== undefined) {
      process.env.IMAGE_GEN_OAI_MODEL = savedModel;
    }
  });

  it('generates with the model chosen in the admin panel, its top quality and every variation', async () => {
    generateImages.mockResolvedValue({ data: [{ b64_json: IMAGE }, { b64_json: IMAGE }] });
    const { generate } = makeTools({
      openai: { model: 'gpt-image-2.5-flare', moderation: 'low' },
    });

    const message = await call(generate, {
      prompt: 'A lighthouse at dawn',
      quality: 'max',
      size: '3840x2160',
      n: 2,
    });

    expect(generateImages).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-image-2.5-flare',
        quality: 'max',
        size: '3840x2160',
        moderation: 'low',
        n: 2,
      }),
      expect.anything(),
    );
    expect(message.artifact.content).toHaveLength(2);
    expect(message.artifact.content[0].type).toBe(ContentTypes.IMAGE_URL);
    expect(message.artifact.file_ids).toHaveLength(2);
    expect(message.content[0].text).toContain('generated_image_ids');
  });

  it('keeps an older model within what it supports', async () => {
    generateImages.mockResolvedValue({ data: [{ b64_json: IMAGE }] });
    const { generate } = makeTools(undefined);

    await call(generate, { prompt: 'A cat', quality: 'xhigh' });
    expect(generateImages).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-1', quality: 'high', n: 1 }),
      expect.anything(),
    );
    expect(generateImages.mock.calls[0][0]).not.toHaveProperty('moderation');

    const refusal = await call(generate, { prompt: 'A cat', size: '2048x2048' });
    expect(String(refusal.content)).toContain('only supports');
    expect(generateImages).toHaveBeenCalledTimes(1);
  });

  it('caps the number of images one call may create', async () => {
    generateImages.mockResolvedValue({ data: [{ b64_json: IMAGE }] });
    const { generate } = makeTools({ openai: { model: 'gpt-image-2' } });
    await call(generate, { prompt: 'Icons', n: 3 });
    await expect(call(generate, { prompt: 'Icons', n: 9 })).rejects.toThrow();
    expect(generateImages).toHaveBeenCalledWith(
      expect.objectContaining({ n: 3 }),
      expect.anything(),
    );
  });

  it('edits with the same options and returns every image', async () => {
    axios.post.mockResolvedValue({ data: { data: [{ b64_json: IMAGE }, { b64_json: IMAGE }] } });
    const imageFiles = [{ file_id: 'img-1', filename: 'a.png', type: 'image/png', filepath: 'a' }];
    const { edit } = makeTools(
      { openai: { model: 'gpt-image-2.5-sunburst', moderation: 'low' } },
      imageFiles,
    );

    const message = await call(edit, {
      prompt: 'Make it night',
      image_ids: ['img-1'],
      background: 'transparent',
      quality: 'xhigh',
      n: 2,
    });

    const form = axios.post.mock.calls[0][1];
    const body = form.getBuffer().toString();
    for (const [field, value] of [
      ['model', 'gpt-image-2.5-sunburst'],
      ['quality', 'xhigh'],
      ['n', '2'],
      ['background', 'transparent'],
      ['output_format', 'png'],
      ['moderation', 'low'],
    ]) {
      expect(body).toMatch(new RegExp(`name="${field}"\\r\\n\\r\\n${value}\\r\\n`));
    }
    expect(message.artifact.file_ids).toHaveLength(2);
    expect(message.content[0].text).toContain('referenced_image_ids: ["img-1"]');
  });

  it('keeps the original edit request for a model it does not recognize', async () => {
    axios.post.mockResolvedValue({ data: { data: [{ b64_json: IMAGE }] } });
    const { edit } = makeTools({ openai: { model: 'my-azure-deployment' } }, [
      { file_id: 'img-1', filename: 'a.png', type: 'image/png', filepath: 'a' },
    ]);

    await call(edit, { prompt: 'Brighter', image_ids: ['img-1'] });
    const body = axios.post.mock.calls[0][1].getBuffer().toString();
    expect(body).toContain('my-azure-deployment');
    expect(body).not.toContain('name="output_format"');
    expect(body).not.toContain('name="n"');
  });
});
