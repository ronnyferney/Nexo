import { Pipe, PipeTransform } from '@angular/core';

/** Muestra una referencia de plantilla Nexo: 'input.id' -> '{{ input.id }}'. */
@Pipe({ name: 'tpl' })
export class TemplateRefPipe implements PipeTransform {
  transform(path: string): string {
    return `{{ ${path} }}`;
  }
}
