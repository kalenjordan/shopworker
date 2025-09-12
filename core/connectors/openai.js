/**
 * OpenAI Assistants API client for processing quiz responses
 */

// Constants
const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 2;

/**
 * OpenAI Assistant client for quiz processing
 */
export class OpenAIAssistantClient {
  constructor(apiKey, assistantId, options = {}) {
    this.apiKey = apiKey;
    this.assistantId = assistantId;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries || MAX_RETRIES;
  }

  /**
   * Create headers for OpenAI API requests
   */
  getHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2'
    };
  }

  /**
   * Format quiz responses for OpenAI assistant
   * @param {Array} quizResponses - Array of quiz question/answer objects
   * @returns {string} Formatted prompt for the assistant
   */
  formatQuizResponses(quizResponses) {
    const formattedResponses = quizResponses.map(item => {
      const question = item.question_title;
      const answer = Array.isArray(item.question_value) 
        ? item.question_value.join(', ') 
        : item.question_value;
      return `Q: ${question}\nA: ${answer}`;
    }).join('\n\n');

    return `Please analyze these skincare quiz responses and provide personalized routine recommendations:\n\n${formattedResponses}`;
  }

  /**
   * Create a thread for the conversation
   */
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

  /**
   * Add a message to the thread
   */
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

  /**
   * Run the assistant on a thread
   */
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

  /**
   * Wait for run completion and get the result
   */
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
        // Get the assistant's response
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

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Assistant run timed out');
  }

  /**
   * Process quiz responses with the OpenAI assistant
   * @param {Array} quizResponses - Array of quiz question/answer objects
   * @returns {Promise<Object>} Parsed assistant response
   */
  async processQuizResponses(quizResponses) {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`Processing quiz with OpenAI assistant (attempt ${attempt + 1}/${this.maxRetries + 1})`);
        
        // Create thread
        const threadId = await this.createThread();
        
        // Format and add message
        const formattedPrompt = this.formatQuizResponses(quizResponses);
        await this.addMessage(threadId, formattedPrompt);
        
        // Run assistant
        const runId = await this.runAssistant(threadId);
        
        // Wait for completion and get result
        const result = await this.waitForRunCompletion(threadId, runId);
        
        console.log('Successfully processed quiz with OpenAI assistant');
        return result;
        
      } catch (error) {
        console.error(`OpenAI assistant attempt ${attempt + 1} failed:`, error.message);
        lastError = error;
        
        // Don't retry on the last attempt
        if (attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`OpenAI assistant failed after ${this.maxRetries + 1} attempts: ${lastError.message}`);
  }
}

/**
 * Create OpenAI assistant client instance
 * @param {Object} env - Environment variables
 * @param {Object} shopConfig - Shop configuration (optional)
 * @returns {OpenAIAssistantClient|null} Client instance or null if not configured
 */
export function createOpenAIClient(env, shopConfig = null) {
  // Try to get API key from environment first, then shop config
  const apiKey = env.OPENAI_API_KEY || shopConfig?.openapi_key;
  const assistantId = env.OPENAI_ASSISTANT_ID || 'asst_WJrcz42JHWfvoc2xmEgR3S3Z';

  if (!apiKey) {
    console.warn('OPENAI_API_KEY not found in environment or shop config - OpenAI processing disabled');
    return null;
  }

  return new OpenAIAssistantClient(apiKey, assistantId);
}