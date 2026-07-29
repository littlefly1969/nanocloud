import * as Updates from 'expo-updates';
import { startBackgroundUpdateCheck as startCheck } from './updateLifecycle';

export function startBackgroundUpdateCheck(): void {
  void startCheck(Updates);
}
