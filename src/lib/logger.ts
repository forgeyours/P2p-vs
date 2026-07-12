type LogListener = (logs: string[]) => void;

let logs: string[] = [];
const listeners = new Set<LogListener>();

export function addLog(msg: string, isError = false) {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  const formatted = `[${timestamp}] ${msg}`;
  
  // Maintain last 50 entries
  logs = [...logs, formatted].slice(-50);
  
  // Trigger listeners
  listeners.forEach((l) => {
    try {
      l(logs);
    } catch (e) {
      console.error('Error calling log listener:', e);
    }
  });

  // Call native console
  if (isError) {
    console.error(msg);
  } else {
    console.log(msg);
  }
}

export function getLogs(): string[] {
  return logs;
}

export function subscribe(listener: LogListener): () => void {
  listeners.add(listener);
  // Immediate trigger with current logs
  listener(logs);
  
  return () => {
    listeners.delete(listener);
  };
}
