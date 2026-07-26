/** Reading the deployed MotifBackendStack: where it is, and what it published. */
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

const STACK_NAME = 'MotifBackendStack';

export const REGION =
  process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? 'eu-west-2';

/**
 * The deployed stack's outputs by key. Every operator script starts here rather
 * than from hard-coded ids, so a redeployed or renamed resource never leaves a
 * script pointing at something that no longer exists.
 */
export async function stackOutputs(region: string): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({ region });
  const described = await cfn.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
  const stack = described.Stacks?.[0];
  if (!stack) throw new Error(`Stack ${STACK_NAME} not found in ${region}`);
  const outputs: Record<string, string> = {};
  for (const output of stack.Outputs ?? []) {
    if (output.OutputKey && output.OutputValue) {
      outputs[output.OutputKey] = output.OutputValue;
    }
  }
  return outputs;
}

/**
 * The Authorization value RevenueCat is configured to send, read from the
 * generated secret named by the `RevenueCatWebhookCredentialSecretName` stack
 * output. Reading it takes AWS credentials, which is what separates an operator
 * from an account holder.
 */
export async function operatorCredential(
  region: string,
  secretName: string,
): Promise<string> {
  const secrets = new SecretsManagerClient({ region });
  const { SecretString } = await secrets.send(
    new GetSecretValueCommand({ SecretId: secretName }),
  );
  if (!SecretString) {
    throw new Error(`Secret ${secretName} held no value to authorize with.`);
  }
  return SecretString;
}
