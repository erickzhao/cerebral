/*
  Connects to the Cerebral debugger
  - Triggers events with information from function tree execution
  - Stores data related to time travel, if activated
*/
class Devtools {
  constructor(options = {}) {
    this.VERSION = 'v1'
    this.storeMutations = options.storeMutations === undefined ? true : options.storeMutations
    this.backlog = []
    this.mutations = []
    this.initialModelString = null
    this.isConnected = false
    this.controller = null
  }
  /*
    To remember state Cerebral stores the initial model as stringified
    object. Since the model is mutable this is necessary. The debugger
    passes the execution id of the signal that was double clicked. This
    execution id is searched backwards in the array of mutations done.
    This is necessary as multiple mutations can be done on the same execution.
    Then all mutations are replayed to the model and all the components
    will be rerendered using the "flush" event and "force" flag.
  */
  remember(executionId) {
    this.controller.model.state = JSON.parse(this.initialModelString)
    let lastMutationIndex
    for (lastMutationIndex = this.mutations.length - 1; lastMutationIndex >= 0; lastMutationIndex--) {
      if (this.mutations[lastMutationIndex].executionId === executionId) {
        break
      }
    }

    for (let x = 0; x <= lastMutationIndex; x++) {
      const mutation = JSON.parse(this.mutations[x].data)

      this.controller.model[mutation.method](...mutation.args)
    }

    this.controller.emit('flush', {}, true)
  }
  /*
    The debugger might be ready or it might not. The initial communication
    with the debugger requires a "ping" -> "pong" to identify that it
    is ready to receive messages.
    1. Debugger is open when app loads
      - Devtools sends "ping"
      - Debugger sends "pong"
      - Devtools sends "init"
    2. Debugger is opened after app load
      - Debugger sends "ping"
      - Devtools sends "init"
  */
  init(controller) {
    const initialModel = controller.model.get()
    this.controller = controller

    if (this.storeMutations) {
      this.initialModelString = JSON.stringify(initialModel)
    }

    window.addEventListener('cerebral2.debugger.remember', (event) => {
      if (!this.storeMutations) {
        console.warn('Cerebral Devtools - You tried to time travel, but you have turned of storing of mutations')
      }
      this.remember(event.detail)
    })
    window.addEventListener('cerebral2.debugger.pong', () => {
      // When debugger responds to a ping
      this.isConnected = true
      this.sendInitial(initialModel)
    })
    window.addEventListener('cerebral2.debugger.ping', () => {
      // When debugger activates
      this.isConnected = true
      this.sendInitial(initialModel)
    })

    const event = new window.CustomEvent('cerebral2.client.message', {
      detail: JSON.stringify({type: 'ping'})
    })
    window.dispatchEvent(event)
  }
  /*
    Send initial model. If model has already been stringified we reuse it. Any
    backlogged executions will also be triggered
  */
  sendInitial(type, initialModel) {
    const initEvent = new window.CustomEvent('cerebral2.client.message', {
      detail: JSON.stringify({
        type: 'init',
        version: this.VERSION,
        data: {
          initialModel: this.initialModelString ? '$$INITIAL_MODEL$$' : initialModel,
          executions: []
        }
      }).replace('\"$$INITIAL_MODEL$$\"', this.initialModelString)
    })
    window.dispatchEvent(initEvent)

    this.backlog.forEach((detail) => {
      const event = new window.CustomEvent('cerebral2.client.message', {
        detail
      })
      window.dispatchEvent(event)
    })
    this.backlog = []
  }
  /*
    Create the stringified event detail for the debugger. As we need to
    store mutations with the default true "storeMutations" option used
    by time travel and jumping between Cerebral apps, we are careful
    not doing unnecessary stringifying.
  */
  createEventDetail(debuggingData, context, functionDetails, payload) {
    const type = 'execution'
    let mutationString = '';

    if (this.storeMutations && debuggingData && debuggingData.type === 'mutation') {
      mutationString = JSON.stringify(debuggingData)
    }

    const data = {
      executions: [{
        name: context.execution.name,
        executionId: context.execution.id,
        functionIndex: functionDetails.functionIndex,
        staticTree: functionDetails.functionIndex === 0 && !debuggingData ? context.execution.staticTree : null,
        payload: payload,
        datetime: context.execution.datetime,
        data: mutationString ? '$$DEBUGGING_DATA$$' : debuggingData
      }]
    }

    if (mutationString) {
      this.mutations.push({
        executionId: context.execution.id,
        data: mutationString
      })
    }

    return JSON.stringify({
      type: type,
      version: this.VERSION,
      data: data
    }).replace('\"$$DEBUGGING_DATA$$\"', mutationString)
  }
  /*
    Sends execution data to the debugger. Whenever a signal starts
    it will send a message to the debugger, but any functions in the
    function tree might also use this to send debugging data. Like when
    mutations are done or any wrapped methods run.
  */
  send(debuggingData = null, context, functionDetails, payload) {
    const detail = this.createEventDetail(debuggingData, context, functionDetails, payload)

    if (this.isConnected) {
      const event = new window.CustomEvent('cerebral2.client.message', {
        detail
      })
      window.dispatchEvent(event)
    } else {
      this.backlog.push(detail)
    }
  }
}

export default function(...args) {
  return new Devtools(...args)
}