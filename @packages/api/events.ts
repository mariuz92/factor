import { EventEmitter } from "events"

const __events = new EventEmitter()

export const emitEvent = (event: string, ...data: unknown[]): void => {
  __events.emit(event, ...data)
}

export const onEvent = (event: string, callback: (...args: any[]) => void): void => {
  __events.on(event, callback)
}

export const offEvent = (event: string, callback: (...args: any[]) => void): void => {
  __events.off(event, callback)
}
