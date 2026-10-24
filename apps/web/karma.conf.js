// Configuración de Karma para `ng test` (P5). Parte de la que trae Angular 20 y agrega un navegador sin interfaz
// apto para CI y contenedores: `ChromeHeadlessCI` (Chrome sin sandbox, necesario al ejecutar como root en Docker).
// El ejecutable se toma de CHROME_BIN (en GitHub Actions, el Chrome preinstalado del runner).
module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
    ],
    client: { jasmine: { random: true }, clearContext: false },
    jasmineHtmlReporter: { suppressAll: true },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }],
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['Chrome'],
    customLaunchers: {
      ChromeHeadlessCI: { base: 'ChromeHeadless', flags: ['--no-sandbox', '--disable-dev-shm-usage'] },
    },
    restartOnFileChange: true,
  });
};
