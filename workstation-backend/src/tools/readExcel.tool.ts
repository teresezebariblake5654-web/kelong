import { parserService, ParsedPreview } from '../services/parser.service';

export function readExcelTool(filePath: string, extension: string): ParsedPreview {
  return parserService.parseExcelFile(filePath, extension);
}
