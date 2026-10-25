import { filterIconNames } from './icon-picker.util';

describe('filterIconNames', () => {
  const names = ['bot', 'arrowLeft', 'chevronUp', 'checkCircle', 'rocket'];

  it('devuelve todos los nombres cuando la búsqueda está vacía', () => {
    expect(filterIconNames(names, '')).toEqual(names);
    expect(filterIconNames(names, '   ')).toEqual(names);
  });

  it('no muta la lista original', () => {
    const copy = filterIconNames(names, '');
    copy.push('x');
    expect(names.length).toBe(5);
  });

  it('filtra sin distinguir mayúsculas', () => {
    expect(filterIconNames(names, 'BOT')).toEqual(['bot']);
    expect(filterIconNames(names, 'Rocket')).toEqual(['rocket']);
  });

  it('separa camelCase para buscar por palabras sueltas', () => {
    expect(filterIconNames(names, 'left')).toEqual(['arrowLeft']);
    expect(filterIconNames(names, 'arrow left')).toEqual(['arrowLeft']);
    expect(filterIconNames(names, 'check circle')).toEqual(['checkCircle']);
  });

  it('devuelve vacío cuando no hay coincidencias', () => {
    expect(filterIconNames(names, 'zzz')).toEqual([]);
  });
});
