import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

// Intl.supportedValuesOf('timeZone') dá a lista canônica de identificadores
// IANA que o próprio runtime reconhece — mais confiável que uma regex (não
// aceita "GMT-3"/"UTC-3"/offsets soltos, e nunca fica desatualizada em
// relação ao tzdata do runtime). Calculado uma vez, não por validação.
const IANA_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

export function IsIanaTimezone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isIanaTimezone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && IANA_TIMEZONES.has(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} deve ser um identificador de timezone IANA válido (ex: "America/Sao_Paulo"), não um offset ("-03:00") ou sigla ("GMT-3").`;
        },
      },
    });
  };
}
