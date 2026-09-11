export class PreviewPrevFileHandler {
  constructor(
    private getFileList: () => string[],
    private getCurrentFileIndex: () => number,
    private setCurrentFileIndex: (idx: number) => void,
    private showPreviewForFile: (filePath: string) => Promise<void>,
  ) {}

  async handle(): Promise<void> {
    const fileList = this.getFileList();
    if (fileList.length === 0) {
      return;
    }
    let idx = this.getCurrentFileIndex();
    idx--;
    if (idx < 0) {
      idx = fileList.length - 1;
    }
    this.setCurrentFileIndex(idx);
    await this.showPreviewForFile(fileList[idx]);
  }
}