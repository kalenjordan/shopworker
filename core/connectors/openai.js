/**
 * OpenAI API client for processing quiz responses with GPT models
 */

// Constants
const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 2;

// Available OpenAI models (as of 2025)
const AVAILABLE_MODELS = [
  // GPT-5 family (August 2025)
  'gpt-5',           // Full-size reasoning model
  'gpt-5-mini',      // Smaller, faster variant
  'gpt-5-nano',      // Smallest, most efficient variant
  
  // GPT-4.1 family
  'gpt-4.1',         // GPT-4.1 model
  'gpt-4.1-mini',    // GPT-4.1 mini variant
  
  // GPT-4 family
  'gpt-4',
  'gpt-4-32k',
  
  // GPT-4o family
  'gpt-4o',
  'gpt-4o-mini',
  
  // O3 reasoning models (Latest 2025)
  'o3',              // Full O3 model
  'o3-mini'          // Smaller O3 variant
];

/**
 * OpenAI Chat Completions client for quiz processing
 */
export class OpenAIChatClient {
  constructor(apiKey, options = {}) {
    if (!options.model) {
      throw new Error('Model is required. Please specify a model in options. Available models: ' + AVAILABLE_MODELS.join(', '));
    }
    
    if (!AVAILABLE_MODELS.includes(options.model)) {
      throw new Error(`Invalid model: ${options.model}. Available models: ${AVAILABLE_MODELS.join(', ')}`);
    }
    
    this.apiKey = apiKey;
    this.model = options.model;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries || MAX_RETRIES;
    this.temperature = options.temperature || 0.7;
    this.maxTokens = options.maxTokens || 4000;
  }

  /**
   * Create headers for OpenAI API requests
   */
  getHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Call the Chat Completions API
   * @param {Array} messages - The messages to send
   * @param {Object} responseSchema - Optional JSON schema for structured output
   */
  async callChatCompletion(messages, responseSchema = null) {
    // GPT-5 models have specific parameter requirements
    const isGPT5Model = this.model.startsWith('gpt-5');
    const maxTokensParam = isGPT5Model ? 'max_completion_tokens' : 'max_tokens';
    
    const requestBody = {
      model: this.model,
      messages: messages,
      [maxTokensParam]: this.maxTokens
    };
    
    // Set response format - use provided schema or default to json_object
    if (responseSchema) {
      requestBody.response_format = {
        type: "json_schema",
        json_schema: responseSchema
      };
    } else {
      requestBody.response_format = { type: "json_object" };
    }
    
    // Model-specific parameters
    if (isGPT5Model) {
      // GPT-5 uses reasoning_effort and verbosity instead of temperature
      requestBody.reasoning_effort = this.reasoningEffort;
      requestBody.verbosity = this.verbosity;
    } else {
      // Other models use temperature
      requestBody.temperature = this.temperature;
    }
    
    // Log the request body for debugging
    console.log('OpenAI API Request Body:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorData}`);
    }

    const jsonResponse = await response.json();
    console.log('API Response Status:', response.status);
    console.log('API Response Headers:', Object.fromEntries(response.headers.entries()));
    
    return jsonResponse;
  }

  /**
   * Process content with the OpenAI Chat API
   * @param {string} systemPrompt - System prompt with instructions
   * @param {string} userContent - User content to process
   * @param {Object} responseSchema - Optional JSON schema for structured output
   * @returns {Promise<{result: Object, runtime: number}>} Response with parsed result and runtime in ms
   */
  async processContent(systemPrompt, userContent, responseSchema = null) {
    let lastError;
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ];

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        console.log(`Processing content with OpenAI ${this.model} (attempt ${attempt + 1}/${this.maxRetries + 1})`);
        
        const response = await this.callChatCompletion(messages, responseSchema);
        const runtime = Date.now() - startTime;
        
        // Log raw response for debugging
        console.log('OpenAI Raw Response:', JSON.stringify(response, null, 2));
        
        // Extract the response content
        const content = response.choices[0]?.message?.content;
        if (!content) {
          console.error('Failed to extract content from response:', {
            hasChoices: !!response.choices,
            choicesLength: response.choices?.length,
            firstChoice: response.choices?.[0],
            message: response.choices?.[0]?.message
          });
          throw new Error('No valid response from OpenAI');
        }
        
        // Parse JSON response
        console.log('Content to parse:', content);
        let result;
        try {
          result = JSON.parse(content);
        } catch (parseError) {
          console.error('Failed to parse JSON response:', parseError.message);
          console.error('Raw content:', content);
          throw new Error(`Invalid JSON in OpenAI response: ${parseError.message}`);
        }
        
        const reasoningInfo = this.model.startsWith('gpt-5') && response.usage?.reasoning_tokens
          ? ` (${response.usage.reasoning_tokens} reasoning tokens)`
          : '';
        console.log(`Successfully processed content with OpenAI ${this.model} in ${runtime}ms${reasoningInfo}`);
        
        // Include token usage information for GPT-5 models
        const returnData = { result, runtime };
        if (this.model.startsWith('gpt-5') && response.usage) {
          returnData.usage = response.usage;
        }
        
        return returnData;
        
      } catch (error) {
        console.error(`OpenAI attempt ${attempt + 1} failed:`, error.message);
        lastError = error;
        
        // Don't retry on the last attempt
        if (attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`OpenAI failed after ${this.maxRetries + 1} attempts: ${lastError.message}`);
  }
}

// Keep the old Assistant client for backward compatibility
export class OpenAIAssistantClient {
  constructor(apiKey, assistantId, options = {}) {
    this.apiKey = apiKey;
    this.assistantId = assistantId;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries || MAX_RETRIES;
  }

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2'
    };
  }

  async createThread() {
    const response = await fetch(`${OPENAI_API_BASE_URL}/threads`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        messages: []
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create thread: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.id;
  }

  async addMessage(threadId, content) {
    const response = await fetch(`${OPENAI_API_BASE_URL}/threads/${threadId}/messages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        role: 'user',
        content: content
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to add message: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async runAssistant(threadId) {
    const response = await fetch(`${OPENAI_API_BASE_URL}/threads/${threadId}/runs`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        assistant_id: this.assistantId
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to run assistant: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.id;
  }

  async waitForRunCompletion(threadId, runId) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < this.timeout) {
      const response = await fetch(`${OPENAI_API_BASE_URL}/threads/${threadId}/runs/${runId}`, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to get run status: ${response.status} ${response.statusText}`);
      }

      const runData = await response.json();
      
      if (runData.status === 'completed') {
        const messagesResponse = await fetch(`${OPENAI_API_BASE_URL}/threads/${threadId}/messages`, {
          method: 'GET',
          headers: this.getHeaders()
        });

        if (!messagesResponse.ok) {
          throw new Error(`Failed to get messages: ${messagesResponse.status} ${messagesResponse.statusText}`);
        }

        const messagesData = await messagesResponse.json();
        const assistantMessage = messagesData.data.find(msg => msg.role === 'assistant');
        
        if (assistantMessage && assistantMessage.content[0]?.text?.value) {
          return JSON.parse(assistantMessage.content[0].text.value);
        }
        
        throw new Error('No valid response from assistant');
      }
      
      if (runData.status === 'failed' || runData.status === 'cancelled' || runData.status === 'expired') {
        throw new Error(`Assistant run ${runData.status}: ${runData.last_error?.message || 'Unknown error'}`);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Assistant run timed out');
  }

  async processContent(content) {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`Processing content with OpenAI assistant (attempt ${attempt + 1}/${this.maxRetries + 1})`);
        
        const threadId = await this.createThread();
        await this.addMessage(threadId, content);
        const runId = await this.runAssistant(threadId);
        const result = await this.waitForRunCompletion(threadId, runId);
        
        console.log('Successfully processed content with OpenAI assistant');
        return result;
        
      } catch (error) {
        console.error(`OpenAI assistant attempt ${attempt + 1} failed:`, error.message);
        lastError = error;
        
        if (attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`OpenAI assistant failed after ${this.maxRetries + 1} attempts: ${lastError.message}`);
  }
}

/**
 * Create OpenAI Chat client instance (new GPT-5 compatible)
 * @param {Object} env - Environment variables
 * @param {Object} shopConfig - Shop configuration (optional)
 * @param {Object} options - Additional options (model, temperature, etc.)
 * @returns {OpenAIChatClient|null} Client instance or null if not configured
 */
export function createOpenAIChatClient(env, shopConfig = null, options = {}) {
  const apiKey = env.OPENAI_API_KEY || shopConfig?.openapi_key;
  
  if (!apiKey) {
    console.warn('OPENAI_API_KEY not found in environment or shop config - OpenAI processing disabled');
    return null;
  }

  // Model must be explicitly provided - no defaults
  const model = options.model || env.OPENAI_MODEL;
  
  if (!model) {
    throw new Error('OpenAI model must be specified via options.model or OPENAI_MODEL environment variable. Available models: ' + AVAILABLE_MODELS.join(', '));
  }
  
  return new OpenAIChatClient(apiKey, { ...options, model });
}

/**
 * Create OpenAI assistant client instance (legacy)
 * @param {Object} env - Environment variables
 * @param {Object} shopConfig - Shop configuration (optional)
 * @returns {OpenAIAssistantClient|null} Client instance or null if not configured
 */
export function createOpenAIClient(env, shopConfig = null) {
  const apiKey = env.OPENAI_API_KEY || shopConfig?.openapi_key;
  const assistantId = env.OPENAI_ASSISTANT_ID || 'asst_WJrcz42JHWfvoc2xmEgR3S3Z';

  if (!apiKey) {
    console.warn('OPENAI_API_KEY not found in environment or shop config - OpenAI processing disabled');
    return null;
  }

  return new OpenAIAssistantClient(apiKey, assistantId);
}