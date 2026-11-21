function createScriptRepeater(signal, onError) {
  const repeat = (fn, intervalNum) => {
    const interval =
      Number.isFinite(Number(intervalNum)) && Number(intervalNum) >= 50
        ? Number(intervalNum)
        : 1000;
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve(true);
        return;
      }

      let busy = false;
      let stopped = false;
      const finish = () => {
        stopped = true;
        clearInterval(timer);
        signal.removeEventListener("abort", finish);
        if (!busy) resolve(true);
      };
      const timer = setInterval(async () => {
        if (busy || signal.aborted) return;
        busy = true;
        try {
          await fn();
        } catch (err) {
          if (!signal.aborted) onError(err);
        } finally {
          busy = false;
          if (stopped) resolve(true);
        }
      }, interval);
      signal.addEventListener("abort", finish, { once: true });
    });
  };
  repeat.signal = signal;
  return repeat;
}

function createScriptRunScheduler({ onWaiting, onError }) {
  const records = new Map();
  const getRecord = (name) => {
    if (!records.has(name)) records.set(name, { generation: 0, running: null });
    return records.get(name);
  };

  function start(name, run) {
    const record = getRecord(name);
    const generation = ++record.generation;
    const launch = () => {
      if (record.generation !== generation) return;
      let result;
      try {
        result = run(generation);
      } catch (err) {
        onError(name, err, generation);
        return;
      }
      const running = Promise.resolve(result);
      record.running = running;
      running.then(
        () => {
          if (record.running === running) record.running = null;
        },
        (err) => {
          if (record.running === running) record.running = null;
          onError(name, err, generation);
        },
      );
    };

    if (record.running) {
      onWaiting(name);
      record.running.then(launch, launch);
    } else {
      launch();
    }
    return generation;
  }

  function cancel(name) {
    getRecord(name).generation++;
  }

  function isCurrent(name, generation) {
    return getRecord(name).generation === generation;
  }

  return { start, cancel, isCurrent };
}

module.exports = { createScriptRepeater, createScriptRunScheduler };
