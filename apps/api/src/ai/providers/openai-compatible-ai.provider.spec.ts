import {
  AiProviderBusyError,
  OpenAiCompatibleAIProvider,
} from './openai-compatible-ai.provider';

function fakeFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as typeof fetch & jest.Mock;
}

describe('OpenAiCompatibleAIProvider', () => {
  const tools = [
    {
      name: 'get_order',
      description: 'Une commande',
      inputSchema: { type: 'object' },
    },
  ];

  it('sends the conversation in the standard format, tool results included', async () => {
    const fetchMock = fakeFetch(200, {
      choices: [{ message: { content: 'OK' } }],
    });
    const provider = new OpenAiCompatibleAIProvider(
      'https://x.test/v1',
      'key',
      'm',
      fetchMock,
    );
    await provider.chat({
      systemPrompt: 'Tu es KORVA IA.',
      tools,
      messages: [
        { role: 'user', content: 'Ma commande ?' },
        {
          role: 'assistant',
          toolCalls: [
            { id: 'c1', name: 'get_order', input: { number: 'CMD-1' } },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'c1',
          toolName: 'get_order',
          content: '{"status":"ok"}',
        },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://x.test/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer key');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.messages).toEqual([
      { role: 'system', content: 'Tu es KORVA IA.' },
      { role: 'user', content: 'Ma commande ?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'get_order', arguments: '{"number":"CMD-1"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"status":"ok"}' },
    ]);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_order',
          description: 'Une commande',
          parameters: { type: 'object' },
        },
      },
    ]);
  });

  it('reads tool calls and usage, and survives malformed arguments', async () => {
    const provider = new OpenAiCompatibleAIProvider(
      'https://x.test/v1',
      'key',
      'm',
      fakeFetch(200, {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: '',
                  type: 'function',
                  function: { name: 'get_order', arguments: '{oops' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      }),
    );
    await expect(
      provider.chat({ systemPrompt: '', messages: [], tools }),
    ).resolves.toEqual({
      type: 'tool_calls',
      toolCalls: [{ id: 'call_0', name: 'get_order', input: {} }],
      usage: { inputTokens: 10, outputTokens: 3 },
    });
  });

  it('reports a saturated provider distinctly', async () => {
    const provider = new OpenAiCompatibleAIProvider(
      'https://x.test/v1',
      'key',
      'm',
      fakeFetch(429, {}),
    );
    await expect(
      provider.chat({ systemPrompt: '', messages: [], tools: [] }),
    ).rejects.toBeInstanceOf(AiProviderBusyError);
  });

  it("keeps Gemini's thought signature and sends it back on the next turn", async () => {
    const signature = { google: { thought_signature: 'sig==' } };
    const first = new OpenAiCompatibleAIProvider(
      'https://x.test/v1',
      'key',
      'm',
      fakeFetch(200, {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: 'c1',
                  type: 'function',
                  function: { name: 'get_order', arguments: '{}' },
                  extra_content: signature,
                },
              ],
            },
          },
        ],
      }),
    );
    const result = await first.chat({ systemPrompt: '', messages: [], tools });
    if (result.type !== 'tool_calls') throw new Error('expected tool calls');
    expect(result.toolCalls[0]!.providerData).toEqual({
      extra_content: signature,
    });

    const fetchMock = fakeFetch(200, {
      choices: [{ message: { content: 'OK' } }],
    });
    const next = new OpenAiCompatibleAIProvider(
      'https://x.test/v1',
      'key',
      'm',
      fetchMock,
    );
    await next.chat({
      systemPrompt: '',
      tools,
      messages: [
        { role: 'assistant', toolCalls: result.toolCalls },
        {
          role: 'tool',
          toolCallId: 'c1',
          toolName: 'get_order',
          content: '{}',
        },
      ],
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { messages: { tool_calls?: { extra_content?: unknown }[] }[] };
    expect(body.messages[1]!.tool_calls![0]!.extra_content).toEqual(signature);
  });
});
