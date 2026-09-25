export function getChatStatusMessage(
  result: { success: boolean; operationResults?: any[]; errors?: any[] },
): string {
  if (result.success && (!result.errors || result.errors.length === 0)) {
    return 'Successful. Check the report at the Report Panel.';
  }

  if (result.operationResults && result.operationResults.length > 0) {
    const successCount = result.operationResults.filter(r => r.status === 'success').length;
    if (successCount > 0) {
      return 'Partially succeeded. Please check the report at the Report Panel.';
    }
  }

  return 'Failed. Check the report at the Report Panel.';
}