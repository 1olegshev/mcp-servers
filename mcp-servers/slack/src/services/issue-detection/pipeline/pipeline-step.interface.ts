/**
 * Pipeline Step Interface
 * Defines the contract for individual steps in the issue detection pipeline
 */

export interface IPipelineStep<TInput, TOutput> {
  /**
   * Execute this step in the pipeline
   */
  execute(input: TInput): Promise<TOutput>;

  /**
   * Get the name of this pipeline step
   */
  getName(): string;

  /**
   * Validate that this step can execute with the given input
   */
  validate(input: TInput): { isValid: boolean; errors: string[] };
}

/**
 * Base pipeline step with common functionality
 */
export abstract class BasePipelineStep<TInput, TOutput> implements IPipelineStep<TInput, TOutput> {
  abstract execute(input: TInput): Promise<TOutput>;
  abstract getName(): string;

  validate(input: TInput): { isValid: boolean; errors: string[] } {
    return { isValid: true, errors: [] };
  }

  protected logExecution(message: string): void {
    console.log(`[${this.getName()}] ${message}`);
  }

  protected logError(error: string): void {
    console.error(`[${this.getName()}] ERROR: ${error}`);
  }
}

/**
 * Pipeline execution context
 */
export interface PipelineContext {
  channel: string;
  date: string;
  startTime: number;
  stepResults: Map<string, any>;
}

/**
 * Pipeline step result wrapper
 */
export interface StepResult<T> {
  success: boolean;
  data: T | null;
  error?: string;
  executionTime: number;
}
