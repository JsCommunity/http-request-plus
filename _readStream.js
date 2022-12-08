"use strict";

module.exports = function readStream(resolve, reject) {
  const chunks = [];
  let length = 0;
  const clean = () => {
    this.removeListener("data", onData);
    this.removeListener("end", onEnd);
    this.removeListener("error", onError);
  };

  const onData = (chunk) => {
    chunks.push(chunk);
    length += chunk.length;
  };
  const onEnd = () => {
    clean();

    resolve(Buffer.concat(chunks, length));
  };
  const onError = (error) => {
    clean();
    reject(error);
  };

  this.on("data", onData);
  this.on("end", onEnd);
  this.on("error", onError);
};
